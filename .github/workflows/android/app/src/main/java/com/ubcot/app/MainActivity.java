package com.ubcot.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/** Hosts the UBC Finance web app in a WebView. Adds: file saving (data: downloads), printing, file chooser. */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/app/www/index.html";
    private static final int PICK = 41;

    private WebView web;
    private ValueCallback<Uri[]> chooser;

    // Intercepts the app's <a download href="data:..."> clicks and hands the file to Android.
    private static final String HOOK =
        "(function(){if(window.__ubcHook)return;window.__ubcHook=1;"
      + "document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[download]'):null;"
      + "if(!a)return;var h=a.getAttribute('href')||'';if(h.indexOf('data:')!==0)return;"
      + "e.preventDefault();e.stopPropagation();var i=h.indexOf(',');var meta=h.substring(5,i);"
      + "AndroidFiles.save(a.getAttribute('download')||'file',meta.split(';')[0],h.substring(i+1));},true);})()";

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(Color.parseColor("#1A0018"));
        getWindow().setNavigationBarColor(Color.parseColor("#1A0018"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#150013"));
        setContentView(web);
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/app/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.addJavascriptInterface(new FilesBridge(), "AndroidFiles");
        web.addJavascriptInterface(new PrintBridge(), "AndroidPrint");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return loader.shouldInterceptRequest(r.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (HOST.equals(r.getUrl().getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, r.getUrl())); } catch (Exception ignored) {}
                return true;
            }
            @Override public void onPageFinished(WebView v, String url) {
                v.evaluateJavascript(HOOK, null);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (chooser != null) chooser.onReceiveValue(null);
                chooser = cb;
                try { startActivityForResult(p.createIntent(), PICK); }
                catch (Exception e) { chooser = null; return false; }
                return true;
            }
        });
        // Fallback: any data: download that slips past the click hook (name unknown there).
        web.setDownloadListener((url, ua, cd, mime, len) -> {
            if (url.startsWith("data:")) {
                int i = url.indexOf(',');
                String m = (mime == null || mime.isEmpty()) ? url.substring(5, i).split(";")[0] : mime;
                String ext = m.contains("pdf") ? ".pdf" : m.contains("json") ? ".json" : m.contains("csv") ? ".csv"
                        : m.contains("wordprocessing") ? ".docx" : ".dat";
                saveBase64("UBC_Finance_" + System.currentTimeMillis() + ext, m, url.substring(i + 1));
            }
        });
        web.loadUrl(START);
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        if (req == PICK && chooser != null) {
            chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            chooser = null;
        } else super.onActivityResult(req, res, data);
    }

    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onPause() { web.onPause(); super.onPause(); }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }

    // Back closes the report preview / goes back through the app's history, then exits.
    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    private void saveBase64(String name, String mime, String b64) {
        try {
            byte[] data = Base64.decode(b64, Base64.DEFAULT);
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                try (OutputStream o = getContentResolver().openOutputStream(u)) { o.write(data); }
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                dir.mkdirs();
                try (FileOutputStream o = new FileOutputStream(new File(dir, name))) { o.write(data); }
            }
            runOnUiThread(() -> Toast.makeText(this, "Saved to Downloads: " + name, Toast.LENGTH_LONG).show());
        } catch (Exception e) {
            runOnUiThread(() -> Toast.makeText(this, "Couldn't save file", Toast.LENGTH_LONG).show());
        }
    }

    private class FilesBridge {
        @JavascriptInterface public void save(String name, String mime, String b64) {
            saveBase64(name, (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime, b64);
        }
    }

    // The web app calls AndroidPrint.print(jobName) from the report preview.
    private class PrintBridge {
        @JavascriptInterface public void print(String jobName) {
            final String name = (jobName == null || jobName.isEmpty()) ? "UBC Finance Report" : jobName;
            runOnUiThread(() -> {
                try {
                    PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                    PrintDocumentAdapter a = web.createPrintDocumentAdapter(name);
                    pm.print(name, a, new PrintAttributes.Builder().build());
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Couldn't open print", Toast.LENGTH_LONG).show();
                }
            });
        }
    }
}
