"""Authenticated API and assessment-isolation tests for Phase 9 practice."""
from uuid import uuid4
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from backend.practice import KNOWN, PracticeRepository, install_practice
from backend.reviews import require_teacher
from backend.auth import check_origin

class DemoAuth:
    @staticmethod
    def current_learner():
        return {'learnerId': 'student-a'}

@pytest.fixture
def app(tmp_path):
    api = FastAPI()
    install_practice(api, DemoAuth(), tmp_path / 'practice.sqlite3')
    api.dependency_overrides[DemoAuth.current_learner] = lambda: {'learnerId':'student-a'}
    api.dependency_overrides[require_teacher] = lambda: True
    api.dependency_overrides[check_origin] = lambda: None
    return api


def blank_run(activity=None, learner='student-a'):
    activity = activity or next(iter(KNOWN.values()))
    return {'runId':str(uuid4()),'learnerId':learner,'sessionId':str(uuid4()),
        'activityId':activity['id'],'contentVersion':activity['version'],
        'skill':activity['skill'],'difficultyTier':activity['difficultyTier'],
        'passageId':activity.get('passageId'), 'startedAt':'2026-11-15T00:00:00Z',
        'completedAt':None,'step':0,'attempts':[],'hints':[],'hintHistory':[],
        'notes':'','intendedUse':'practice'}


def complete_run(run):
    activity = KNOWN[run['activityId']]
    run['attempts'] = []
    for index,step in enumerate(activity['steps']):
        is_guide = step['kind'] == 'guide'
        run['attempts'].append({'step':index,'response':'guided' if is_guide else step['answer'],
                                'correct':None if is_guide else True,'assistance':['teacher-guided']})
    run['step'] = len(activity['steps'])-1
    run['completedAt'] = '2026-11-15T00:10:00Z'
    return run


def test_student_persistence_teacher_visibility_and_no_assessment_evidence(app):
    client = TestClient(app)
    run = blank_run()
    assert client.put(f"/api/student/practice/{run['runId']}",json=run).status_code == 200
    assert client.get('/api/student/practice').json() == [run]
    # Teacher can see progress across browsers through the database.
    assert client.get('/api/teacher/learners/student-a/practice').json() == [run]
    finished = complete_run(run.copy())
    assert client.put(f"/api/student/practice/{finished['runId']}",json=finished).status_code == 200
    assert client.put(f"/api/student/practice/{finished['runId']}",json=finished).status_code == 200
    assert len(client.get('/api/student/practice').json()) == 1
    assert client.get('/api/student/practice').json()[0]['completedAt']
    assert not any(route.path.startswith('/api/evidence') for route in app.routes)


def test_user_cannot_write_another_learner_or_another_id(app):
    client = TestClient(app)
    run = blank_run(learner='student-b')
    assert client.put(f"/api/student/practice/{run['runId']}",json=run).status_code == 403
    run['learnerId']='student-a'
    assert client.put(f'/api/student/practice/{uuid4()}',json=run).status_code == 403
    assert client.get('/api/student/practice').json() == []


def test_bad_quiz_answer_rejected_and_completed_record_immutable(app):
    client=TestClient(app)
    activity=next(a for a in KNOWN.values() if any(s['kind']=='choice' for s in a['steps']))
    run=blank_run(activity)
    step=next(i for i,s in enumerate(activity['steps']) if s['kind']=='choice')
    run['attempts']=[{'step':step,'response':activity['steps'][step]['answer'], 'correct':False,'assistance':[]}]
    assert client.put(f"/api/student/practice/{run['runId']}",json=run).status_code == 422
    completed=complete_run(blank_run(activity))
    assert client.put(f"/api/student/practice/{completed['runId']}",json=completed).status_code == 200
    completed['notes']='tampered'
    assert client.put(f"/api/student/practice/{completed['runId']}",json=completed).status_code == 409


def test_teacher_key_is_required_when_not_overridden(tmp_path):
    api=FastAPI()
    install_practice(api,DemoAuth(),tmp_path/'p.db')
    api.dependency_overrides[DemoAuth.current_learner]=lambda:{'learnerId':'student-a'}
    client=TestClient(api)
    result=client.get('/api/teacher/learners/student-a/practice')
    assert result.status_code in (403,503)
