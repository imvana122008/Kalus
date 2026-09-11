package com.kalus.viberschedule
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit
object TelegramSender{
 private val c=OkHttpClient.Builder().connectTimeout(15,TimeUnit.SECONDS).readTimeout(35,TimeUnit.SECONDS).build()
 fun sendMessageBlocking(t:String,id:String,s:String):Boolean=try{val b=FormBody.Builder().add("chat_id",id).add("text",s).build();c.newCall(Request.Builder().url("https://api.telegram.org/bot$t/sendMessage").post(b).build()).execute().use{it.isSuccessful}}catch(_:Exception){false}
 fun sendPhotoBlocking(t:String,id:String,j:ByteArray,cap:String):Boolean=try{val b=MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("chat_id",id).addFormDataPart("caption",cap).addFormDataPart("photo","schedule.jpg",j.toRequestBody("image/jpeg".toMediaType())).build();c.newCall(Request.Builder().url("https://api.telegram.org/bot$t/sendPhoto").post(b).build()).execute().use{it.isSuccessful}}catch(_:Exception){false}
 fun sendTestBlocking(t:String,id:String)=sendMessageBlocking(t,id,"✅ Kalus: Telegram підключено")
 data class Update(val updateId:Long,val chatId:String,val text:String)
 fun getUpdatesBlocking(t:String,o:Long): List<Update> = try{val u=HttpUrl.Builder().scheme("https").host("api.telegram.org").addPathSegment("bot$t").addPathSegment("getUpdates").addQueryParameter("offset",o.toString()).addQueryParameter("timeout","20").build();c.newCall(Request.Builder().url(u).build()).execute().use{r->if(!r.isSuccessful)return emptyList();val a=JSONObject(r.body?.string().orEmpty()).optJSONArray("result")?:return emptyList();buildList{for(i in 0 until a.length()){val x=a.getJSONObject(i);val m=x.optJSONObject("message")?:continue;add(Update(x.optLong("update_id"),m.getJSONObject("chat").optLong("id").toString(),m.optString("text").trim()))}}}}catch(_:Exception){emptyList()}
}
