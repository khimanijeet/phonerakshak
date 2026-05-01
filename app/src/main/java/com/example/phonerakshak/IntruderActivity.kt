package com.example.phonerakshak

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.example.phonerakshak.databinding.ActivityIntrudersBinding
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Grid view of captured intruder photos. */
class IntruderActivity : AppCompatActivity() {

    private lateinit var binding: ActivityIntrudersBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityIntrudersBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnBack.setOnClickListener { finish() }
        binding.btnDeleteAll.setOnClickListener {
            SilentCamera.listIntruderPhotos(this).forEach { it.delete() }
            render()
        }
        render()
    }

    private fun render() {
        val files = SilentCamera.listIntruderPhotos(this)
        binding.txtCount.text = resources.getQuantityString(
            R.plurals.intruders_count, files.size, files.size
        )
        if (files.isEmpty()) {
            binding.empty.visibility = View.VISIBLE
            binding.recycler.visibility = View.GONE
            return
        }
        binding.empty.visibility = View.GONE
        binding.recycler.visibility = View.VISIBLE
        binding.recycler.layoutManager = GridLayoutManager(this, 2)
        binding.recycler.adapter = Adapter(files)
    }

    private class Adapter(private val files: List<File>) :
        RecyclerView.Adapter<Adapter.VH>() {

        class VH(view: View) : RecyclerView.ViewHolder(view) {
            val img: ImageView = view.findViewById(R.id.img)
            val ts: TextView = view.findViewById(R.id.txtTs)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
            val v = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_intruder, parent, false)
            return VH(v)
        }

        override fun getItemCount(): Int = files.size

        override fun onBindViewHolder(holder: VH, position: Int) {
            val f = files[position]
            try {
                val bmp = PhotoUtils.decodeRotated(f, sampleSize = 4)
                if (bmp != null) holder.img.setImageBitmap(bmp)
                else holder.img.setImageResource(android.R.drawable.ic_menu_camera)
            } catch (_: Exception) {
                holder.img.setImageResource(android.R.drawable.ic_menu_camera)
            }
            holder.ts.text = SimpleDateFormat("MMM d, yyyy HH:mm", Locale.getDefault())
                .format(Date(f.lastModified()))
            holder.itemView.setOnClickListener {
                val ctx = holder.itemView.context
                val intent = Intent(ctx, PhotoViewerActivity::class.java)
                    .putExtra(PhotoViewerActivity.EXTRA_PATH, f.absolutePath)
                ctx.startActivity(intent)
            }
        }
    }
}
