package com.kalus.viberschedule

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private lateinit var status: TextView
    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { refreshStatus() }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); setContentView(R.layout.activity_main)
        val p=getSharedPreferences("cfg",MODE_PRIVATE); val bt=findViewById<EditText>(R.id.botToken); val ci=findViewById<EditText>(R.id.chatId); val tg=findViewById<EditText>(R.id.targets); val en=findViewById<CheckBox>(R.id.enabled); status=findViewById(R.id.status)
        bt.setText(p.getString("botToken","")); ci.setText(p.getString("chatId","")); tg.setText(p.getString("targets","М223/9,М224/11")); en.isChecked=p.getBoolean("enabled",true)
        findViewById<Button>(R.id.save).setOnClickListener { saveQuick(bt,ci,tg,en); Toast.makeText(this,"✅ Налаштування збережено",Toast.LENGTH_SHORT).show() }
        findViewById<Button>(R.id.permissions).setOnClickListener { requestNeededPermissions() }
        findViewById<Button>(R.id.start).setOnClickListener { saveQuick(bt,ci,tg,en); if(!hasImagePermission()){requestNeededPermissions();Toast.makeText(this,"Спочатку дозволь доступ до фото",Toast.LENGTH_LONG).show()}else{p.edit().putBoolean("enabled",true).apply();ContextCompat.startForegroundService(this,Intent(this,ScheduleWatcherService::class.java));status.text="🟢 Монітор працює. Нові фото перевіряються автоматично."} }
        findViewById<Button>(R.id.stop).setOnClickListener { p.edit().putBoolean("enabled",false).apply();stopService(Intent(this,ScheduleWatcherService::class.java));status.text="⏸ Монітор зупинено" }
        findViewById<Button>(R.id.testTelegram).setOnClickListener { saveQuick(bt,ci,tg,en);status.text="Перевіряю Telegram…";thread { val ok=TelegramSender.sendTestBlocking(bt.text.toString().trim(),ci.text.toString().trim());runOnUiThread{status.text=if(ok)"✅ Telegram підключено" else "❌ Не вдалося. Перевір bot token та chat_id"} } }
        findViewById<Button>(R.id.battery).setOnClickListener { try{startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))}catch(_:Exception){startActivity(Intent(Settings.ACTION_SETTINGS))} };refreshStatus()
    }
    private fun saveQuick(bt:EditText,ci:EditText,tg:EditText,en:CheckBox){getSharedPreferences("cfg",MODE_PRIVATE).edit().putString("botToken",bt.text.toString().trim()).putString("chatId",ci.text.toString().trim()).putString("targets",tg.text.toString().trim()).putBoolean("enabled",en.isChecked).apply()}
    private fun requestNeededPermissions(){val list=mutableListOf<String>();if(Build.VERSION.SDK_INT>=33){list+=Manifest.permission.READ_MEDIA_IMAGES;list+=Manifest.permission.POST_NOTIFICATIONS}else list+=Manifest.permission.READ_EXTERNAL_STORAGE;permissionLauncher.launch(list.toTypedArray())}
    private fun hasImagePermission():Boolean=if(Build.VERSION.SDK_INT>=33) ContextCompat.checkSelfPermission(this,Manifest.permission.READ_MEDIA_IMAGES)==PackageManager.PERMISSION_GRANTED else ContextCompat.checkSelfPermission(this,Manifest.permission.READ_EXTERNAL_STORAGE)==PackageManager.PERMISSION_GRANTED
    private fun refreshStatus(){val p=getSharedPreferences("cfg",MODE_PRIVATE);status.text=when{!hasImagePermission()->"🟡 Потрібен доступ до фото";p.getBoolean("enabled",false)->p.getString("status","🟢 Готово до запуску");else->"⚪ Налаштуй Telegram і натисни «Запустити 24/7»"}}
}
