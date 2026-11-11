package kr.moneycheck.sms;

import android.app.Activity;
import android.Manifest;
import android.os.Bundle;
import android.content.pm.PackageManager;
import android.text.InputType;
import android.widget.*;
import android.view.View;

public class MainActivity extends Activity {
    private EditText token,senders;private TextView status;
    private void label(LinearLayout layout,String value,int size){TextView text=new TextView(this);text.setText(value);text.setTextSize(size);text.setPadding(0,20,0,12);layout.addView(text);}
    private void button(LinearLayout layout,String text,View.OnClickListener action){Button b=new Button(this);b.setText(text);b.setOnClickListener(action);layout.addView(b);}
    @Override public void onCreate(Bundle state){super.onCreate(state);
        ScrollView scroll=new ScrollView(this);LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(32,40,32,40);scroll.addView(layout);setContentView(scroll);
        label(layout,"머니체크 문자 연결",26);
        label(layout,"지정한 카드사 발신 번호의 새 결제 문자만 머니체크 서버에 전달합니다. 카드 문자 원문은 인식에 사용하고 서버에 보관하지 않습니다. 인터넷이 없을 때는 휴대폰에 암호화하여 최대 300건을 보관합니다. 과거 문자·MMS·앱 알림은 읽지 않습니다.",16);
        label(layout,"웹사이트 → 문자 연결 → 연결 키 만들기",16);
        token=new EditText(this);token.setHint("64자리 연결 키 붙여넣기");token.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);token.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);layout.addView(token);
        label(layout,"허용할 카드사 발신 번호 (여러 개는 쉼표로 구분)",16);
        senders=new EditText(this);senders.setHint("카드 문자에 표시된 발신 번호");senders.setText(getSharedPreferences("settings",0).getString("senders",""));layout.addView(senders);
        button(layout,"동의하고 문자 연결 시작",v->{try{
            String key=token.getText().toString().trim();if(key.isEmpty())key=Vault.read(this,"token","");
            if(!key.matches("[a-f0-9]{64}"))throw new Exception("웹에서 발급한 64자리 연결 키를 입력하세요.");
            String nums=senders.getText().toString().trim();if(!nums.matches("[+0-9 ,()-]{4,200}")||nums.matches(".*(?:^|,)\\s*(?:,|$).*"))throw new Exception("카드사 발신 번호를 입력하세요.");
            for(String n:nums.split(","))if(!SmsReceiver.number(n).matches("\\+?[0-9]{4,15}"))throw new Exception("발신 번호를 확인하세요.");
            synchronized(Queue.class){String old=Vault.read(this,"token","");if(!old.equals(key))Vault.write(this,"queue","[]");Vault.write(this,"token",key);}
            token.setText("");getSharedPreferences("settings",0).edit().putString("senders",nums).putBoolean("enabled",false).commit();
            if(checkSelfPermission(Manifest.permission.RECEIVE_SMS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.RECEIVE_SMS},1);else enable();
        }catch(Exception e){status.setText(e.getMessage());}});
        button(layout,"대기 문자 다시 전송",v->{Queue.schedule(this);status.setText("전송을 예약했습니다. 잠시 후 상태를 확인하세요.");});
        button(layout,"상태 확인",v->refresh());
        button(layout,"연결 중지 및 휴대폰 대기 내역 삭제",v->{try{getSharedPreferences("settings",0).edit().putBoolean("enabled",false).commit();getSystemService(android.app.job.JobScheduler.class).cancel(11);synchronized(Queue.class){Vault.write(this,"token","");Vault.write(this,"queue","[]");}Queue.status(this,"휴대폰 연결을 중지했습니다. 웹에서도 연결을 해제하세요.");refresh();}catch(Exception e){status.setText("설정을 지우지 못했습니다. 다시 시도하세요.");}});
        status=new TextView(this);status.setTextSize(16);status.setPadding(0,24,0,12);layout.addView(status);refresh();
        label(layout,"인식이 안 된 문자·해외 결제·부분 취소는 직접 기록하세요. 취소는 환불 수입으로 기록됩니다. 고정지출 자동 기록과 중복되면 한쪽 내역을 삭제하세요. 앱 강제 종료 시 다시 열어야 수신이 재개됩니다.",14);
    }
    private void refresh(){status.setText((getSharedPreferences("settings",0).getBoolean("enabled",false)?"연결 켜짐\n":"연결 꺼짐\n")+getSharedPreferences("settings",0).getString("status","연결 키와 카드사 번호를 입력하세요."));}
    private void enable(){getSharedPreferences("settings",0).edit().putBoolean("enabled",true).commit();Queue.status(this,"새 카드 문자를 기다리고 있습니다.");Queue.schedule(this);refresh();}
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){super.onRequestPermissionsResult(request,permissions,grants);if(request==1&&grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED)enable();else status.setText("문자 수신 권한을 허용해야 연결할 수 있습니다.");}
}
