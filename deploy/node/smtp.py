"""SMTP transport: credentials only from private process environment, message on stdin."""
import json,os,smtplib,ssl,sys
from email.message import EmailMessage
from email.utils import make_msgid
message=json.load(sys.stdin)
mail=EmailMessage()
mail['Subject']=message['subject'];mail['To']=message['to']
mail['From']=os.environ.get('SMTP_FROM') or os.environ.get('SMTP_USERNAME')
mail['Message-ID']=make_msgid(domain='rockshowbot.local')
mail.set_content(message['body'])
host=os.environ['SMTP_HOST'];port=int(os.environ.get('SMTP_PORT','587'))
client=smtplib.SMTP_SSL(host,port,timeout=30,context=ssl.create_default_context()) if port==465 else smtplib.SMTP(host,port,timeout=30)
try:
 if port!=465 and os.environ.get('SMTP_STARTTLS','true')=='true':client.starttls(context=ssl.create_default_context())
 if os.environ.get('SMTP_USERNAME'):client.login(os.environ['SMTP_USERNAME'],os.environ['SMTP_PASSWORD'])
 rejected=client.send_message(mail)
 if rejected:raise RuntimeError('Recipient rejected')
 print(json.dumps({'accepted':True,'messageId':mail['Message-ID']}),flush=True)
finally:
 client.close()
