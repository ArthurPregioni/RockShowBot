"""SMTP transport and authentication-only check; private configuration from env."""
import json,os,smtplib,ssl,sys
from email.message import EmailMessage
from email.utils import make_msgid


def deliver(message,config=None,factory=None):
    config=os.environ if config is None else config
    client=None;stage='connect'
    try:
        host=config['SMTP_HOST'];port=int(config.get('SMTP_PORT','587'))
        if factory:
            client=factory(host,port)
        elif port==465:
            client=smtplib.SMTP_SSL(host,port,timeout=30,context=ssl.create_default_context())
        else:
            client=smtplib.SMTP(host,port,timeout=30)
        if port!=465 and config.get('SMTP_STARTTLS','true')=='true':
            stage='tls';client.starttls(context=ssl.create_default_context())
        stage='auth'
        if config.get('SMTP_USERNAME'):
            client.login(config['SMTP_USERNAME'],config['SMTP_PASSWORD'])
        if message.get('validate'):
            return {'authenticated':True,'accepted':False}
        stage='compose'
        mail=EmailMessage()
        mail['Subject']=message['subject'];mail['To']=message['to']
        mail['From']=config.get('SMTP_FROM') or config.get('SMTP_USERNAME')
        mail['Message-ID']=make_msgid(domain='rockshowbot.local')
        mail.set_content(message['body'])
        stage='data'
        rejected=client.send_message(mail)
        if rejected:return {'accepted':False,'uncertain':False,'error':'recipient-rejected'}
        return {'accepted':True,'messageId':mail['Message-ID']}
    except smtplib.SMTPAuthenticationError:
        return {'authenticated':False,'accepted':False,'uncertain':False,'error':'authentication'}
    except (smtplib.SMTPRecipientsRefused,smtplib.SMTPSenderRefused,smtplib.SMTPDataError):
        return {'accepted':False,'uncertain':False,'error':'rejected'}
    except Exception:
        return {'accepted':False,'uncertain':stage=='data','error':'connection' if stage in ('connect','tls') else 'transport'}
    finally:
        if client:
            try:client.close()
            except Exception:pass


if __name__=='__main__':
    result=deliver(json.load(sys.stdin))
    print(json.dumps(result),flush=True)
    sys.exit(0 if result.get('authenticated') or result.get('accepted') else 1)
