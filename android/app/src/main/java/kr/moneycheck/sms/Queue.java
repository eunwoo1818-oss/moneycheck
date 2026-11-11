package kr.moneycheck.sms;

import android.content.Context;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import org.json.JSONArray;
import org.json.JSONObject;

final class Queue {
    static synchronized void add(Context c,JSONObject item) throws Exception {
        JSONArray list=new JSONArray(Vault.read(c,"queue","[]"));
        if(list.length()>=300)throw new Exception("대기 문자가 300건입니다. 앱을 열어 전송 상태를 확인하세요.");
        list.put(item);Vault.write(c,"queue",list.toString());schedule(c);
    }
    static synchronized JSONObject first(Context c) throws Exception {JSONArray a=new JSONArray(Vault.read(c,"queue","[]"));return a.length()>0?a.getJSONObject(0):null;}
    static synchronized void remove(Context c,JSONObject expected) throws Exception {JSONArray a=new JSONArray(Vault.read(c,"queue","[]"));if(a.length()>0&&a.getJSONObject(0).toString().equals(expected.toString())){a.remove(0);Vault.write(c,"queue",a.toString());}}
    static void status(Context c,String text){c.getSharedPreferences("settings",0).edit().putString("status",text).apply();}
    static void schedule(Context c){
        JobInfo job=new JobInfo.Builder(11,new ComponentName(c,UploadJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).setBackoffCriteria(30000,JobInfo.BACKOFF_POLICY_EXPONENTIAL).build();
        if(c.getSystemService(JobScheduler.class).schedule(job)==JobScheduler.RESULT_FAILURE)status(c,"전송 예약 실패. 앱을 열어 다시 전송하세요.");
    }
}
