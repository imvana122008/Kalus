package com.kalus.viberschedule
import android.content.*
import android.graphics.*
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
object ScheduleImageProcessor{
 private fun norm(s:String)=s.uppercase().replace(" ","").replace("M","М")
 fun process(c:Context,u:Uri):Boolean{val p=c.getSharedPreferences("cfg",Context.MODE_PRIVATE);val targets=p.getString("targets","М223/9,М224/11")!!.split(',').map{it.trim()};val b=c.contentResolver.openInputStream(u)?.use{BitmapFactory.decodeStream(it)}?:return false;val r=TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);val l=CountDownLatch(1);var txt="";r.process(InputImage.fromBitmap(b,0)).addOnSuccessListener{txt=it.text;l.countDown()}.addOnFailureListener{l.countDown()};l.await(15,TimeUnit.SECONDS);r.close();val found=targets.filter{norm(txt).contains(norm(it))};if(found.isEmpty())return false;val out=ByteArrayOutputStream();b.compress(Bitmap.CompressFormat.JPEG,90,out);val bytes=out.toByteArray();val hash=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)};if(hash==p.getString("lastHash",""))return false;val token=p.getString("botToken","").orEmpty();val id=p.getString("chatId","").orEmpty();if(token.isBlank()||id.isBlank())return false;val ok=TelegramSender.sendPhotoBlocking(token,id,bytes,"📚 Розклад: ${found.joinToString(" + ")}\n📥 Viber");if(ok){p.edit().putString("lastHash",hash).apply();try{java.io.File(c.filesDir,"last_schedule.jpg").writeBytes(bytes)}catch(_:Exception){}};return ok}
}
