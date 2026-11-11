package kr.moneycheck.sms;

import android.app.job.JobService;
import android.app.job.JobParameters;
import org.json.JSONObject;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;

public class UploadJob extends JobService {
    private volatile boolean stopped;
    @Override public boolean onStartJob(JobParameters p){stopped=false;new Thread(()->{
        boolean retry=false;
        try{
            while(!stopped&&getSharedPreferences("settings",0).getBoolean("enabled",false)){
                JSONObject item=Queue.first(this);if(item==null)break;
                String token=Vault.read(this,"token","");if(token.isEmpty())break;
                HttpsURLConnection connection=(HttpsURLConnection)new URL("https://moneycheck-ivory.vercel.app/api/sms/receive").openConnection();
                try{
                    connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(10000);connection.setReadTimeout(15000);
                    connection.setRequestMethod("POST");connection.setRequestProperty("Content-Type","application/json");connection.setRequestProperty("Authorization","Bearer "+token);connection.setDoOutput(true);
                    try(var out=connection.getOutputStream()){out.write(item.toString().getBytes(StandardCharsets.UTF_8));}
                    int status=connection.getResponseCode();
                    if(status==401){getSharedPreferences("settings",0).edit().putBoolean("enabled",false).apply();Queue.status(this,"연결 키가 만료되었거나 해제되었습니다. 웹에서 새 키를 만드세요.");break;}
                    if(status!=200){retry=true;Queue.status(this,"전송 보류. 인터넷 연결 후 재시도합니다.");break;}
                    String body;try(var in=connection.getInputStream();var buffer=new java.io.ByteArrayOutputStream()){byte[] bytes=new byte[2048];int count;while((count=in.read(bytes))!=-1){if(buffer.size()+count>16384)throw new java.io.IOException();buffer.write(bytes,0,count);}body=buffer.toString("UTF-8");}
                    JSONObject result=new JSONObject(body);Queue.remove(this,item);Queue.status(this,result.optString("message","처리했습니다."));
                }finally{connection.disconnect();}
            }
        }catch(Exception e){retry=true;Queue.status(this,"전송 보류. 인터넷 연결 후 재시도합니다.");}
        if(!stopped)jobFinished(p,retry);
    },"sms-upload").start();return true;}
    @Override public boolean onStopJob(JobParameters p){stopped=true;return true;}
}
