"""End-to-end synthetic workflow: email -> 3 takes -> teacher verdict -> planner."""
import io
import os
import tempfile
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.auth import EmailAuth
from backend.server import create_app

@pytest.fixture()
def env(monkeypatch, tmp_path):
    monkeypatch.setenv('LITERA_TEACHER_KEY', 'local-test-teacher-key-only')
    monkeypatch.setenv('LITERA_PRACTICE_DB', str(tmp_path/'practice.sqlite3'))
    sent = []
    auth = EmailAuth(tmp_path / 'accounts.sqlite3', lambda email, pw: sent.append((email, pw)))
    client = TestClient(create_app(auth, review_path=tmp_path/'reviews.sqlite3', evidence_path=tmp_path/'evidence.sqlite3'))
    return client, sent


def login(env, address='student@example.com'):
    client,sent=env
    r=client.post('/api/auth/signup',json={'email':address});assert r.status_code==200,r.text
    password=sent[-1][1]
    r=client.post('/api/auth/verify',json={'email':address,'purpose':'signup','password':password})
    assert r.status_code==200,r.text
    return r.json()['learnerId']


def submit_recordings(client, form='PHONICS-A', count=5, takes=3):
    attempt,session=str(uuid4()),str(uuid4())
    data={'attempt':attempt,'session':session,'form':form,
          'slots':__import__('json').dumps([[i,j] for i in range(count) for j in range(1,takes+1)])}
    files=[('clips',(f'clip-{i}-{j}.webm',b'fake-audio-'+bytes([i,j]),'audio/webm'))
           for i in range(count) for j in range(1,takes+1)]
    r=client.post('/api/recording-submissions',data=data,files=files)
    assert r.status_code==201,r.text
    return attempt,session


def test_student_teacher_boundary_all_takes_and_verified_progress(env):
    client,sent=env
    learner=login(env)
    r=client.get('/api/forms');assert r.status_code==200
    assert r.json()[0]['formId']=='PHONICS-A'
    attempt,session=submit_recordings(client)
    queue=client.get('/api/student/submissions');assert len(queue.json())==1
    assert queue.json()[0]['result'] is None
    r=client.get(f'/api/student/submissions/{attempt}/slots');assert len(r.json())==15
    assert client.get('/api/teacher/submissions').status_code==403
    teacher={'X-Teacher-Key':'local-test-teacher-key-only'}
    assert len(client.get('/api/teacher/submissions',headers=teacher).json())==1
    r=client.get(f'/api/teacher/submissions/{attempt}/audio/4/3',headers=teacher)
    assert r.status_code==200 and r.content==b'fake-audio-'+bytes([4,3])
    r=client.post(f'/api/teacher/submissions/{attempt}/review',headers=teacher,
        json={'marks':['CORRECT']*4+['INCORRECT'],'selectedTakes':[3]*5,'assisted':False,'verified':True,'note':'Reviewed all three takes.'})
    assert r.status_code==200,r.text
    assert r.json()['event']['correct']==4
    assert client.post(f'/api/teacher/submissions/{attempt}/review',headers=teacher,
        json={'marks':['CORRECT']*5,'selectedTakes':[3]*5,'assisted':False,'verified':True}).status_code==409
    student=client.get('/api/student/submissions').json()[0]
    assert student['result']['event']['correct']==4
    assert student['status']=='validated'
    profile=client.get('/api/student/profile')
    assert profile.status_code==200,profile.text
    assert profile.json()['recommendation']['primary']
    assert any(s['skill']=='phonics' for s in profile.json()['skills'])
    assert len(sent)==1
    # Teachers may change the recommendation, but not rewrite the scored event.
    override=client.post('/api/teacher/overrides',headers=teacher,json={
        'overrideId':str(uuid4()),'learnerId':learner,'sessionId':session,
        'primaryActivityId':'GUIDED_ORAL_READING','why':'Observation during reading assessment',
        'timestamp':'2026-11-15T00:00:00+00:00'})
    assert override.status_code==200,override.text
    profile=client.get('/api/student/profile').json()
    assert profile['recommendation']['primary']['activityId']=='GUIDED_ORAL_READING'
    assert len(profile['overrides'])==1
    assert client.get('/api/teacher/forms',headers=teacher).status_code==200
    assert client.get('/api/teacher/passages',headers=teacher).status_code==200
    assert client.get('/api/teacher/comprehension/forms',headers=teacher).status_code==200


def test_oral_and_comprehension_teacher_validation(env):
    client,_=env
    learner=login(env)
    oral,session=submit_recordings(client,'ORAL-A',count=1,takes=3)
    teacher={'X-Teacher-Key':'local-test-teacher-key-only'}
    words=__import__('backend.reviews',fromlist=['words']).words
    from backend.reviews import PASSAGES
    import json
    passage=next(p for p in json.loads(PASSAGES.read_text()) if p['formId']=='ORAL-A')
    marks=['CORRECT']*len(words(passage))
    r=client.post(f'/api/teacher/submissions/{oral}/review',headers=teacher,
                  json={'marks':marks,'selectedTakes':[2],'assisted':False,'verified':True})
    assert r.status_code==200,r.text
    forms=client.get('/api/comprehension/forms').json()
    form=forms[0]
    # The student receives no answer key from the public API.
    assert 'correctAnswerId' not in json.dumps(form)
    answers=[{'questionId':q['questionId'],'answerId':q['choices'][0]['answerId']} for q in form['questions']]
    attempt=str(uuid4())
    r=client.post('/api/comprehension/submissions',json={'attemptId':attempt,'sessionId':str(uuid4()),
                   'formId':form['formId'],'responses':answers,'assisted':False})
    assert r.status_code==201,r.text
    assert client.get('/api/student/submissions').json()[0]['result'] is None
    provisional=r.json()['provisional']['items']
    r=client.post(f'/api/teacher/submissions/{attempt}/review',headers=teacher,json={
        'marks':['CORRECT' if p['correct'] else 'INCORRECT' for p in provisional],
        'selectedTakes':[],'assisted':False,'verified':True})
    assert r.status_code==200,r.text
    assert client.get('/api/student/profile').status_code==200


def test_bad_slots_and_role_separation(env):
    client,_=env
    a=login(env)
    id=str(uuid4())
    data={'attempt':id,'session':str(uuid4()),'form':'PHONICS-A','slots':'[[0,1]]'}
    r=client.post('/api/recording-submissions',data=data,files=[('clips',('x.webm',b'abc','audio/webm'))]);assert r.status_code==422
    first,_=submit_recordings(client,takes=1)
    assert client.post(f'/api/student/submissions/{first}/estimate').status_code==200
    assert client.post(f'/api/teacher/submissions/{first}/review',json={'marks':['CORRECT']*5,
        'selectedTakes':[1]*5,'assisted':False,'verified':True}).status_code==403
    client.post('/api/auth/logout')
    login(env,'second@example.com')
    assert client.get(f'/api/student/submissions/{first}/slots').status_code==404
    assert client.get(f'/api/student/submissions/{first}/audio/0/1').status_code==404
    assert client.get('/api/student/profile').status_code==200


def test_logged_in_gamification_does_not_create_scores(env):
    from backend.practice import KNOWN
    client, _ = env
    learner = login(env)
    original = client.get('/api/student/profile').json()
    activity = next(iter(KNOWN.values()))
    run = {
        'runId': str(uuid4()), 'learnerId': learner, 'sessionId': str(uuid4()),
        'activityId': activity['id'], 'contentVersion': activity['version'],
        'skill': activity['skill'], 'difficultyTier': activity['difficultyTier'],
        'passageId': activity.get('passageId'), 'startedAt': '2026-11-15T00:00:00Z',
        'completedAt': None, 'step': 0, 'attempts': [], 'hints': [],
        'hintHistory': [], 'notes': '', 'intendedUse': 'practice',
    }
    assert client.put(f"/api/student/practice/{run['runId']}", json=run).status_code == 200
    assert client.get('/api/student/practice').json()[0]['activityId'] == activity['id']
    assert client.get('/api/teacher/learners/'+learner+'/practice').status_code == 403
    teacher = {'X-Teacher-Key':'local-test-teacher-key-only'}
    assert len(client.get('/api/teacher/learners/'+learner+'/practice', headers=teacher).json()) == 1
    assert client.get('/api/student/profile').json()['events'] == original['events']
    assert client.get('/api/student/profile').json()['skills'] == original['skills']
    client.post('/api/auth/logout')
    assert client.get('/api/student/practice').status_code == 401
