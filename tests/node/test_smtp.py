import importlib.util
from pathlib import Path
import smtplib,unittest
spec=importlib.util.spec_from_file_location('smtp_transport',Path(__file__).resolve().parents[2]/'deploy/node/smtp.py')
transport=importlib.util.module_from_spec(spec);spec.loader.exec_module(transport)
CONFIG={'SMTP_HOST':'smtp.example.test','SMTP_PORT':'587','SMTP_STARTTLS':'true','SMTP_USERNAME':'bot@example.test','SMTP_PASSWORD':'qa-only-password','SMTP_FROM':'Bot <bot@example.test>'}
class FakeSMTP:
    def __init__(self,auth_error=False,send_error=None):self.events=[];self.auth_error=auth_error;self.send_error=send_error
    def starttls(self,**kwargs):self.events.append('tls')
    def login(self,*args):
        self.events.append('auth')
        if self.auth_error:raise smtplib.SMTPAuthenticationError(535,b'rejected')
    def send_message(self,message):
        self.events.append('data')
        if self.send_error:raise self.send_error
        return {}
    def close(self):self.events.append('close')
class SMTPTests(unittest.TestCase):
    def test_credential_check_authenticates_without_sending_mail(self):
        client=FakeSMTP();result=transport.deliver({'validate':True},CONFIG,lambda *_:client)
        self.assertTrue(result['authenticated']);self.assertFalse(result['accepted']);self.assertEqual(client.events,['tls','auth','close'])
    def test_bad_password_is_a_definite_rejection(self):
        client=FakeSMTP(auth_error=True);result=transport.deliver({'validate':True},CONFIG,lambda *_:client)
        self.assertFalse(result['uncertain']);self.assertEqual(result['error'],'authentication');self.assertNotIn('data',client.events)
    def test_smtp_acceptance_records_the_real_message_id(self):
        client=FakeSMTP();result=transport.deliver({'to':'recipient@example.test','subject':'QA','body':'Synthetic QA'},CONFIG,lambda *_:client)
        self.assertTrue(result['accepted']);self.assertIn('@rockshowbot.local',result['messageId']);self.assertIn('data',client.events)
    def test_disconnect_during_data_is_ambiguous_but_explicit_rejection_is_not(self):
        message={'to':'recipient@example.test','subject':'QA','body':'Synthetic QA'}
        ambiguous=transport.deliver(message,CONFIG,lambda *_:FakeSMTP(send_error=smtplib.SMTPServerDisconnected('lost')))
        self.assertTrue(ambiguous['uncertain']);self.assertFalse(ambiguous['accepted'])
        rejected=transport.deliver(message,CONFIG,lambda *_:FakeSMTP(send_error=smtplib.SMTPDataError(550,b'rejected')))
        self.assertFalse(rejected['uncertain']);self.assertFalse(rejected['accepted'])
if __name__=='__main__':unittest.main()
