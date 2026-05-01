package com.example.phonerakshak

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.example.phonerakshak.databinding.ActivityPhotoViewerBinding
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Fullscreen viewer for a single intruder photo. */
class PhotoViewerActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPhotoViewerBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPhotoViewerBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnBack.setOnClickListener { finish() }

        val path = intent.getStringExtra(EXTRA_PATH) ?: run { finish(); return }
        val file = File(path)
        if (!file.exists()) { finish(); return }

        val bmp = PhotoUtils.decodeRotated(file, sampleSize = 1)
        if (bmp != null) binding.img.setImageBitmap(bmp)

        binding.txtTs.text = SimpleDateFormat("MMM d, yyyy HH:mm:ss", Locale.getDefault())
            .format(Date(file.lastModified()))
    }

    companion object {
        const val EXTRA_PATH = "extra_path"
    }
}
