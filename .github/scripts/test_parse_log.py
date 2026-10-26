import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('parser', Path(__file__).with_name('parse_log.py'))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

class ParserTests(unittest.TestCase):
    def report(self, **sections):
        return json.dumps({'format':'vetro-diagnostics','schemaVersion':1,'sections':{k:{'status':'ok','data':v} for k,v in sections.items()}})

    def test_root_success_not_persistence(self):
        r = p.analyze(self.report(platform={'running':True,'rootAgent':{'connected':True,'uid':0}}, device={'realModel':'QE50Q80AATXZT','firmware':'T-NKM2DEUC-2301.1'}))
        s = p.markdown(r)
        self.assertIn('UID 0',s)
        self.assertIn('Unknown; requires a new cold boot',s)
        self.assertIn('single tested TV',s)

    def test_service_read_firmware_and_component_details(self):
        s = p.markdown(p.analyze(self.report(
            device={'realModel':'GU75CU7179','firmware':'T-KSU2EBDEUC-1720.7','firmwareSource':'service-read','tizenVersion':'6.5.0'},
            components={'packages':[
                {'packageId':'vetrotvapp','origin':'installed','components':[{'appId':'vetrotvapp.svc','differs':True},{'appId':'vetrotvapp.app','differs':False}]},
                {'packageId':'com.samsung.tv.iacr','origin':'preinstalled','components':[{'appId':'com.samsung.tv.iacr','differs':True}]},
                {'packageId':'com.someone.private','origin':'installed','components':[{'appId':'com.someone.private','differs':True}]},
                {'packageId':'x','origin':'installed','components':'<script>'}]})))
        self.assertIn('Read from the TV by the Vetro service',s)
        self.assertIn('| Tizen version | 6.5.0 |',s)
        self.assertIn('4 unrecognised packages read; 3 with start flags that differ',s)
        self.assertIn('vetrotvapp.svc, com.samsung.tv.iacr',s)
        self.assertNotIn('com.someone.private',s)
        self.assertNotIn('<script>',s)
        self.assertNotIn('unrecognised)',s,'launcher, quickWins and components are known sections')

    def test_components_not_requested_is_not_a_failure(self):
        report = json.dumps({'format':'vetro-diagnostics','schemaVersion':1,'sections':{'components':{'status':'unavailable','reason':'not-requested'},'hbbtv':{'status':'unavailable','reason':'command-failed','exitCode':1}}})
        s = p.markdown(p.analyze(report))
        self.assertIn('Sections not collected | 1: hbbtv',s)
        self.assertNotIn('components (',s)

    def test_disconnected_and_stopped(self):
        s = p.markdown(p.analyze(self.report(platform={'running':False,'rootAgent':{'connected':False}})))
        self.assertIn('Reported disconnected',s)
        self.assertIn('Reported stopped',s)

    def test_unknown_and_no_personal_echo(self):
        secret = 'SECRET@example.com <script> @all'
        s = p.markdown(p.analyze(self.report(device={'model':secret},mqtt={'password':secret})))
        self.assertNotIn(secret,s)
        self.assertIn('Unknown',s)

    def test_bools_are_not_uid(self):
        s = p.markdown(p.analyze(self.report(platform={'rootAgent':{'connected':True,'uid':False}})))
        self.assertNotIn('with UID 0',s)

    def test_firmware_derived_controls_report_the_tv_check(self):
        items = [{'id':'blurReduction','writable':True,'access':'firmware','probe':'confirmed','available':True},
                 {'id':'hdmiBlackLevel','writable':False,'access':'firmware','probe':'missing','available':True},
                 {'id':'x','writable':False,'access':'firmware','probe':'<script>','available':True}]
        s = p.markdown(p.analyze(self.report(settings={'items':items,'api':{'status':'ok','methods':223}})))
        self.assertIn('1 confirmed, 1 missing, 1 unchecked (223 picture API methods exposed)',s)
        self.assertNotIn('<script>',s)

    def test_invalid_schemas(self):
        for value in ['{}','[]','{"format":"vetro-diagnostics","schemaVersion":2}', '{bad']:
            with self.assertRaises(ValueError):p.analyze(value)

    def test_bad_section_shapes(self):
        p.analyze(json.dumps({'format':'vetro-diagnostics','schemaVersion':1,'sections':{'monitor':[],'probe':{'status':'ok','data':[]}}}))

    def test_structured_report_status_words_are_not_signatures(self):
        text = json.dumps({'format':'vetro-diagnostics','schemaVersion':1,'sections':{'startup':{'status':'timeout','reason':'report-deadline'}}})
        r = p.analyze(text)
        self.assertEqual(r['signatures'],[])
        self.assertIn('startup (timeout: report deadline reached)',p.markdown(r))

    def test_missing_sections_use_allowlists(self):
        secret = 'SECRET@example.com'
        text = json.dumps({'format':'vetro-diagnostics','schemaVersion':1,'sections':{
            secret:{'status':'unavailable'},
            'startup':{'status':secret,'reason':secret,'exitCode':127},
            'network':{'status':'unavailable','reason':'command-failed','exitCode':secret}}})
        s = p.markdown(p.analyze(text))
        self.assertNotIn(secret,s)
        self.assertIn('startup (unavailable: reason not recorded, exit code 127)',s)
        self.assertIn('network (unavailable: command failed)',s)
        self.assertIn('plus 1 unrecognised',s)

    def test_provenance_and_revision_rows(self):
        text = json.dumps({'format':'vetro-diagnostics','schemaVersion':1,'sourceRevision':'a'*40,'sourceDirty':True,'sections':{
            'device':{'status':'ok','data':{'model':'M','source':'widget-probe','probeAgeMinutes':120}}}})
        s = p.markdown(p.analyze(text))
        self.assertIn('last probe about 120 min before export',s)
        self.assertIn('aaaaaaa (build differed from it)',s)
        self.assertNotIn('a'*40,s)

    def test_legacy_signatures(self):
        r = p.analyze('uid=0 ECONNREFUSED EACCES SIGSEGV secret-password')
        self.assertEqual(len(r['signatures']),3)
        self.assertNotIn('secret-password',p.markdown(r))

    def test_attachment_validation(self):
        self.assertTrue(p.attachment_url('https://github.com/user-attachments/files/123/report.json'))
        self.assertTrue(p.attachment_url('https://github.com/owner/repo/files/123/report.json'))
        for u in ['http://github.com/user-attachments/files/1/r.json','https://github.com.evil.test/user-attachments/files/1/r.json','https://github.com@evil.test/r.json','https://github.com:443/user-attachments/files/1/r.json','https://github.com/user-attachments/files/1/r.zip','file:///etc/passwd','https://127.0.0.1/r.json']:
            self.assertFalse(p.attachment_url(u))
        self.assertFalse(p.download_host('https://169.254.169.254/'))
        self.assertFalse(p.download_host('https://random-bucket.s3.amazonaws.com/'))

    def test_inline_and_multiple_reports(self):
        text = self.report()
        self.assertEqual(p.report_text('```json\n'+text+'\n```'),text)
        with self.assertRaises(ValueError):p.report_text('https://github.com/user-attachments/files/1/a.json https://github.com/user-attachments/files/2/b.json')

    def test_issue_selection(self):
        self.assertTrue(p.issue_matches({'title':'[Log report] Q80','body':'### Vetro diagnostic report'}))
        self.assertFalse(p.issue_matches({'title':'ordinary issue','body':'### Vetro diagnostic report'}))

    def test_comment_updates_bot_only(self):
        calls=[]
        def api(path, token, method='GET', data=None):
            calls.append((path,method,data))
            return [{'id':12,'user':{'login':'human'},'body':p.MARKER},{'id':13,'user':{'login':'github-actions[bot]'},'body':p.MARKER}] if method=='GET' else {}
        with patch.dict('os.environ', {'GITHUB_REPOSITORY':'owner/repo','GITHUB_TOKEN':'fixture'}),patch.object(p,'api',api):p.post_comment({'number':1},p.MARKER+' report')
        self.assertEqual(calls[-1][1],'PATCH')
        self.assertTrue(calls[-1][0].endswith('/13'))

if __name__ == '__main__':unittest.main()
