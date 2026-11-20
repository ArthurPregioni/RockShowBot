"""SMTP transport and authentication-only check; private configuration from env."""
import json,os,re,smtplib,ssl,sys
from email.message import EmailMessage
from email.utils import make_msgid,formatdate,parseaddr,getaddresses


def single_recipient(value):
    """Separators or quoting in 'to' would address several mailboxes; accept exactly one."""
    if not isinstance(value,str) or re.search(r'[\r\n]',value):return False
    found=[address for _,address in getaddresses([value])]
    return len(found)==1 and re.fullmatch(r'[^\s@]+@[^\s@]+',found[0]) is not None


def deliver(message,config=None,factory=None):
    config=os.environ if config is None else config
    client=None;stage='connect'
    try:
        if not message.get('validate') and not single_recipient(message.get('to')):
            return {'accepted':False,'uncertain':False,'error':'recipient-invalid'}
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
        address=parseaddr(mail['From'])[1]
        domain=address.rsplit('@',1)[-1] if '@' in address else None
        mail['Date']=formatdate(usegmt=True)
        mail['Message-ID']=make_msgid(domain=domain)
        if message.get('id'):mail['X-RockShowBot-Delivery-ID']=message['id']
        mail.set_content(message['body'])
        if message.get('html'):mail.add_alternative(message['html'],subtype='html')
        stage='data'
        # Refusal of every recipient raises. A partial refusal still delivered the message, so it counts as sent.
        client.send_message(mail)
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
