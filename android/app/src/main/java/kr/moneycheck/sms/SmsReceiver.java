package kr.moneycheck.sms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import org.json.JSONObject;

public class SmsReceiver extends BroadcastReceiver {
    static String number(String s){String n=s==null?"":s.replaceAll("[^0-9+]","");return n.startsWith("+82")?"0"+n.substring(3):n;}
    @Override public void onReceive(Context c,Intent intent){
        if(!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction()) || !c.getSharedPreferences("settings",0).getBoolean("enabled",false))return;
        PendingResult pending=goAsync();
        new Thread(()->{try{
            SmsMessage[] messages=Telephony.Sms.Intents.getMessagesFromIntent(intent);if(messages.length==0)return;
            String sender=number(messages[0].getOriginatingAddress());boolean allowed=false;
            for(String configured:c.getSharedPreferences("settings",0).getString("senders","").split(","))if(!sender.isEmpty()&&sender.equals(number(configured)))allowed=true;
            if(!allowed)return;
            StringBuilder text=new StringBuilder();for(SmsMessage sms:messages){if(!sender.equals(number(sms.getOriginatingAddress())))return;text.append(sms.getMessageBody());}
            String body=text.toString();
            if(body.length()>2000||!body.matches("(?s).*(카드|신한|현대|삼성|롯데|국민|농협|하나|우리|비씨|KB|NH|BC).*"))return;
            if(!body.matches("(?s).*(승인|취소|20[0-9]{2}[.][0-9]{2}[.][0-9]{2}).*")||body.matches("(?s).*(인증|거절|비밀번호|일회용|OTP).*"))return;
            Queue.add(c,new JSONObject().put("sender",sender).put("message",body).put("receivedAt",messages[0].getTimestampMillis()));
            Queue.status(c,"카드 문자 수신. 전송 대기 중입니다.");
        }catch(Exception e){Queue.status(c,"문자 저장 실패. 앱을 열어 연결을 확인하세요.");}finally{pending.finish();}},"sms-receive").start();
    }
}
