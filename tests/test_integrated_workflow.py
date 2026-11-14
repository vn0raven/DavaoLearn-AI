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
        'hintHistory': [], 'audioAssistance': [{'step': 0, 'source': 'model'}],
        'notes': '', 'intendedUse': 'practice',
    }
    assert client.put(f"/api/student/practice/{run['runId']}", json=run).status_code == 200
    assert client.get('/api/student/practice').json()[0]['activityId'] == activity['id']
    assert client.get('/api/teacher/learners/'+learner+'/practice').status_code == 403
    teacher = {'X-Teacher-Key':'local-test-teacher-key-only'}
    teacher_runs = client.get('/api/teacher/learners/'+learner+'/practice', headers=teacher).json()
    assert len(teacher_runs) == 1
    assert teacher_runs[0]['audioAssistance'] == run['audioAssistance']
    assert client.get('/api/student/profile').json()['events'] == original['events']
    assert client.get('/api/student/profile').json()['skills'] == original['skills']
    client.post('/api/auth/logout')
    assert client.get('/api/student/practice').status_code == 401


def test_blank_oral_transcript_is_unscorable_and_preserves_teacher_result(env, monkeypatch):
    from backend.reviews import words

    client, _ = env
    login(env)
    attempt, _ = submit_recordings(client, 'ORAL-A', count=1, takes=1)
    monkeypatch.setattr('backend.reviews.speech.decode_audio', lambda *_: object())
    monkeypatch.setattr('backend.reviews.speech.transcribe', lambda _: ' ... ')
    estimate = client.post(f'/api/student/submissions/{attempt}/estimate').json()
    assert estimate['status'] == 'unavailable'
    assert {item['verdict'] for item in estimate['items']} == {'UNCERTAIN'}
    repo = client.app.state.reviews
    count = len(words(repo.passages['ORAL-A']))
    result = client.post(f'/api/teacher/submissions/{attempt}/review',
                         headers={'X-Teacher-Key':'local-test-teacher-key-only'},
                         json={'marks':['CORRECT']*count, 'selectedTakes':[1], 'verified':True, 'assisted':False})
    assert result.status_code == 200, result.text
    assert result.json()['event']['correct'] == count
    # Present old blank-transcript estimates safely without rewriting original rows.
    import json
    old = json.dumps({'transcript':'', 'items':[{'word':'Lino', 'verdict':'LIKELY_INCORRECT'}]})
    with repo.connect() as db:
        db.execute('UPDATE submissions SET provisional=? WHERE id=?', (old, attempt))
    snapshot = client.get('/api/student/submissions').json()[0]
    assert snapshot['result']['event']['correct'] == count
    assert snapshot['provisional']['items'][0]['verdict'] == 'UNCERTAIN'
    assert repo.get(attempt)['provisional'] == old


@pytest.mark.parametrize('form,reuse_session', [('PHONICS-A', False), ('PHONICS-B', True)])
def test_logically_duplicate_recording_with_new_id_is_rejected(env, form, reuse_session):
    import json

    client, _ = env
    login(env)
    _, session = submit_recordings(client, takes=1)
    body = {'attempt':str(uuid4()), 'session':session if reuse_session else str(uuid4()),
            'form':form, 'slots':json.dumps([[i,1] for i in range(5)])}
    files = [('clips',('demo.webm',b'synthetic-sample','audio/webm')) for _ in range(5)]
    assert client.post('/api/recording-submissions', data=body, files=files).status_code == 409
    assert len(client.get('/api/student/submissions').json()) == 1


def test_duplicate_comprehension_new_id_keeps_verified_profile(env):
    client, _ = env
    login(env)
    form = client.get('/api/comprehension/forms').json()[0]
    body = {'attemptId':str(uuid4()), 'sessionId':str(uuid4()), 'formId':form['formId'],
            'responses':[{'questionId':q['questionId'], 'answerId':q['choices'][0]['answerId']}
                         for q in form['questions']]}
    assert client.post('/api/comprehension/submissions', json=body).status_code == 201
    review = client.post(f"/api/teacher/submissions/{body['attemptId']}/review",
                         headers={'X-Teacher-Key':'local-test-teacher-key-only'},
                         json={'marks':['CORRECT']*len(form['questions']), 'verified':True, 'assisted':False})
    assert review.status_code == 200
    before = client.get('/api/student/profile').json()
    duplicate = {**body, 'attemptId':str(uuid4()), 'sessionId':str(uuid4())}
    assert client.post('/api/comprehension/submissions', json=duplicate).status_code == 409
    assert client.get('/api/student/profile').json() == before


def test_fresh_check_requires_approval_and_reserves_one_unseen_form(env):
    client, _ = env
    login(env)
    attempt, session = submit_recordings(client, takes=1)
    response = client.post(f'/api/teacher/submissions/{attempt}/review',
                           headers={'X-Teacher-Key':'local-test-teacher-key-only'},
                           json={'marks':['CORRECT']*3+['INCORRECT']*2, 'selectedTakes':[1]*5,
                                 'verified':True, 'assisted':False})
    assert response.status_code == 200
    url = '/api/student/reassessment/phonics'
    assert client.post(url).json()['formId'] is None
    repo = client.app.state.reviews
    repo.store.approved.update({
        ('phonics', form.difficultyTier, form.formId, form.version, 'v1', 'standard'):'test-only-group'
        for form in repo.forms.values()
    })
    fresh = client.post(url).json()
    assert fresh['formId'] == 'PHONICS-B' and fresh['sessionId'] != session
    assert client.post(url).json()['formId'] is None
    assert client.post('/api/student/assessment-exposure',
                       data={'formId':'PHONICS-B', 'sessionId':str(uuid4())}).status_code == 409
    import json
    body = {'attempt':str(uuid4()), 'session':fresh['sessionId'], 'form':fresh['formId'],
            'slots':json.dumps([[i,1] for i in range(5)])}
    files = [('clips',('demo.webm',b'synthetic-sample','audio/webm')) for _ in range(5)]
    assert client.post('/api/recording-submissions', data={**body, 'session':str(uuid4())}, files=files).status_code == 409
    assert client.post('/api/recording-submissions', data=body, files=files).status_code == 201


def test_seen_passage_in_other_skill_is_not_a_fresh_form(env):
    client, _ = env
    login(env)
    attempt, session = submit_recordings(client, 'ORAL-A', count=1, takes=1)
    response = client.post(f'/api/teacher/submissions/{attempt}/review',
                           headers={'X-Teacher-Key':'local-test-teacher-key-only'},
                           json={'marks':['CORRECT']*41, 'selectedTakes':[1], 'verified':True, 'assisted':False})
    assert response.status_code == 200
    repo = client.app.state.reviews
    repo.store.approved.update({
        ('oral', form['difficultyTier'], form['formId'], form['version'], 'v1', 'standard'):'test-only-group'
        for form in repo.passages.values()
    })
    assert client.post('/api/student/assessment-exposure',
                       data={'formId':'COMP-B', 'sessionId':session}).status_code == 200
    assert client.post('/api/student/reassessment/oral').json()['formId'] is None


def test_canonical_server_keeps_teacher_and_legacy_evidence_routes_separate(env):
    client, _ = env
    learner = login(env)
    assert client.get(f'/api/teacher/learners/{learner}/profile').status_code == 403
    assert client.post('/api/teacher/overrides', json={}).status_code == 403
    assert client.get(f'/api/evidence/learners/{learner}').status_code == 404
    assert client.post('/api/evidence/oral', json={}).status_code == 404


def test_teacher_cannot_validate_historic_pending_duplicate(env):
    client, _ = env
    learner = login(env)
    attempt, session = submit_recordings(client, takes=1)
    headers = {'X-Teacher-Key':'local-test-teacher-key-only'}
    marks = {'marks':['CORRECT']*3+['INCORRECT']*2, 'selectedTakes':[1]*5,
             'verified':True, 'assisted':False}
    assert client.post(f'/api/teacher/submissions/{attempt}/review', headers=headers, json=marks).status_code == 200
    baseline = client.get('/api/student/profile').json()
    older_duplicate = str(uuid4())
    with client.app.state.reviews.connect() as db:
        db.execute('INSERT INTO submissions (id,learner,session,skill,form,created_at) VALUES (?,?,?,?,?,?)',
                   (older_duplicate, learner, session, 'phonics', 'PHONICS-A', '2026-11-15T00:00:00Z'))
    assert client.post(f'/api/teacher/submissions/{older_duplicate}/review', headers=headers, json=marks).status_code == 409
    assert client.get('/api/student/profile').json() == baseline
