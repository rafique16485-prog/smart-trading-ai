package com.smarttradingai.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://smart-trading-ai-ashen.vercel.app/?app=android&v=91";
    private WebView web;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window w=getWindow();
        w.setStatusBarColor(Color.rgb(6,31,75));
        w.setNavigationBarColor(Color.rgb(7,58,143));
        if(Build.VERSION.SDK_INT>=23) w.getDecorView().setSystemUiVisibility(0);
        if(Build.VERSION.SDK_INT>=30) w.setDecorFitsSystemWindows(true);

        web=new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(-1,-1));
        setContentView(web);

        WebSettings s=web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadsImagesAutomatically(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString()+" SmartTradingAI/9.0 Android");

        CookieManager cm=CookieManager.getInstance();
        cm.setAcceptCookie(true);
        if(Build.VERSION.SDK_INT>=21) cm.setAcceptThirdPartyCookies(web,true);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req){
                Uri u=req.getUrl();
                String host=u.getHost()==null?"":u.getHost().toLowerCase();
                if(host.equals("smart-trading-ai-ashen.vercel.app") || host.endsWith(".upstox.com")) return false;
                if("https".equals(u.getScheme()) || "http".equals(u.getScheme())){
                    try { startActivity(new Intent(Intent.ACTION_VIEW,u)); } catch(Exception ignored){}
                    return true;
                }
                return false;
            }
            @Override public void onPageFinished(WebView view,String url){
                CookieManager.getInstance().flush();
            }
        });
        web.loadUrl(APP_URL);
    }

    @Override public void onBackPressed(){
        if(web!=null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
