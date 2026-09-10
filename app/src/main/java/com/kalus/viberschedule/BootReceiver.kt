package com.kalus.viberschedule
import android.content.*
import androidx.core.content.ContextCompat
class BootReceiver:BroadcastReceiver(){override fun onReceive(c:Context,i:Intent?){if(i?.action==Intent.ACTION_BOOT_COMPLETED&&c.getSharedPreferences("cfg",Context.MODE_PRIVATE).getBoolean("enabled",false))ContextCompat.startForegroundService(c,Intent(c,ScheduleWatcherService::class.java))}}
