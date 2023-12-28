﻿using System;
using System.Reflection;
using System.Windows;
using System.IO;
using Microsoft.Web.WebView2.Core;
using System.Diagnostics;
using Sigma.Hubs;
using Microsoft.Extensions.Hosting;
using System.ComponentModel;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Builder;
using System.Threading;
using System.Windows.Input;
using System.Security.Policy;
using Microsoft.AspNetCore.Hosting.Server;
using Newtonsoft.Json;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using DeepL;
using DeepL.Model;
using IniParser;
using IniParser.Model;
using System.Collections.Generic;

namespace sigmanuts_webview2
{
    /// <summary>
    /// This class is fairly loaded because I couldnt be bothered to split it up
    /// 
    /// Defined main app window, hosts SignalR instance for interaction between the app and 
    /// the server on which the widget is server, and handles window interactions.
    /// 
    /// If someone decides to organize it without losing any functionality, be my guest.
    /// </summary>
    public partial class MainWindow : Window
    {
        public static string CacheFolderPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Sigmanuts");

        private Microsoft.AspNetCore.SignalR.IHubContext<StreamHub> hubContext; // This is not used anymore, but I'll leave it here
        private bool isChatEnabled = false;
        private bool isPreviewEnabled = false;
        private static string currentWidget = "";

        /// <summary>
        /// URLs
        /// </summary>

        private string chatUrl = "http://localhost:6969/tutorial.html";//"https://www.youtube.com/live_chat?v=jfKfPfyJRdk"
        private string appUrl = "http://localhost:6969/app.html";
        private string widgetUrl = $"http://localhost:6969/widgets-bili/{currentWidget}/widget.html";

        private SimpleHTTPServer myServer;
        
        //DeepL translation
        private Translator translator;
        private string CONFIG_FILE = Path.Combine(CacheFolderPath, @".\localserver\widgets-bili\config.ini");
        const string CONFIG_AUTH_KEY = "deepl_auth_key";
        const string CONFIG_TARGET_LANG_KEY = "target_lang";
        private string targetLanguage = "EN-US";
        private bool hasSentTranslationNotice = false;
        private string authKey = "";

        const int MAX_TRANSLATION_MESSAGES = 3;
        const int TRANSLATION_INTERVAL_MS = 1000;

        private System.Timers.Timer translateTimer;
        private List<TranslationNode> translateBuffer;

        private class TranslationNode
        {
            public string sourceText;
            public string uid;
            public string ct;
            public string ts;
            public string username;
            public string sourceLang;
            public string targetLang;
            public string translatedText;

            public TranslationNode(string sourceText, string username, string uid, string ct, string ts, string targetLanguage)
            {
                this.sourceText = sourceText;
                this.username = username;
                this.uid = uid;
                this.ct = ct;
                this.ts = ts;
                this.targetLang = targetLanguage;
            }

            public void setTranslation(DeepL.Model.TextResult res)
            {
                this.sourceText = res.DetectedSourceLanguageCode;
                this.translatedText = res.Text;
            }
        }

        private void AddTranslationBuffer(string sourceText, string username, string uid, string ct, string ts)
        {
            TranslationNode node = new TranslationNode(sourceText, username, uid, ct, ts, targetLanguage);

            webView.CoreWebView2.ExecuteScriptAsync("console.log('node: " + node.sourceText + "')");

            if (translateBuffer==null)
            {
                translateBuffer = new List<TranslationNode>();
            }
            translateBuffer.Add(node);

            if(translateBuffer.Count>=MAX_TRANSLATION_MESSAGES)
            {
                DoTranslations("maxmessage-"+MAX_TRANSLATION_MESSAGES);
            }
        }

        private void IntervalDoTranslations(Object source, System.Timers.ElapsedEventArgs e)
        {

            this.Dispatcher.Invoke(() =>
            {
                DoTranslations("interval");
            });

        }

        public int batchNo = 0;

        private async void DoTranslations(string reason="")
        {
            if (translateBuffer == null) return;
            if (translateBuffer.Count < 1) return;
            batchNo++;
            List<TranslationNode> nodes = translateBuffer;
            translateBuffer = null;
            List<string> texts = new List<string>();
            int b = batchNo;
            for(int i = 0;i<nodes.Count;i++)
            {
                texts.Add(nodes[i].sourceText);
            }

            try
            {
                TextResult[] tr = await translator.TranslateTextAsync(texts, "zh", targetLanguage);

                for (int i = 0; i < tr.Length; i++)
                {
                    nodes[i].setTranslation(tr[i]);
                }

                for (int i = 0; i < nodes.Count; i++)
                {

                    TranslationNode node = nodes[i];
                    string tl = Uri.EscapeDataString(node.translatedText);
                    webView.CoreWebView2.ExecuteScriptAsync($"sendTranslationData(`{tl}`, '{node.sourceText}', '{node.username}' ,'{node.sourceLang}', '{node.targetLang}', '{node.uid}', '{node.ct}', '{node.ts}', '{reason}');");

                }
            }
            catch(Exception e)
            {
                webView.CoreWebView2.ExecuteScriptAsync("console.log('ERROR CATCH: " + e.Message + "')");
            }
        }

        public MainWindow()
        {
            try
            {
                var parser = new FileIniDataParser();
                IniData translationConfig = parser.ReadFile(@CONFIG_FILE);
                translationConfig.GetKey(CONFIG_AUTH_KEY);

                authKey = translationConfig["sigmanuts-webview2-bili"][CONFIG_AUTH_KEY];
                targetLanguage = translationConfig["sigmanuts-webview2-bili"][CONFIG_TARGET_LANG_KEY].ToUpper();
                if (targetLanguage == "")
                {
                    targetLanguage = "EN";
                }

                if (authKey != "")
                {
                    translator = new Translator(authKey);
                }

                if(translator!=null)
                {
                    translateTimer = new System.Timers.Timer();
                    translateTimer.Interval = TRANSLATION_INTERVAL_MS;
                    translateTimer.Elapsed += IntervalDoTranslations;
                    translateTimer.AutoReset = true;
                    translateTimer.Enabled = true;

                }

                InitializeComponent();
                Directory.CreateDirectory(Path.Combine(CacheFolderPath, @".\localserver\widgets-bili"));

                if (!File.Exists(Path.Combine(CacheFolderPath, @".\localserver")))
                {
                    string sourceDirectory = Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), @".\web-src");
                    string targetDirectory = Path.Combine(CacheFolderPath, @".\localserver");

                    Debug.WriteLine(sourceDirectory);

                    DirectoryInfo diSource = new DirectoryInfo(sourceDirectory);
                    DirectoryInfo diTarget = new DirectoryInfo(targetDirectory);

                    CopyDir.CopyAll(diSource, diTarget);
                }

                HandleWidgets();

                Debug.WriteLine("Running...");

                new Thread(() => InitSignalR()) { IsBackground = true }.Start();

                // Start the server
                string folder = Path.Combine(CacheFolderPath, @".\localserver");
                myServer = new SimpleHTTPServer(folder, 6969);
                currentWidget = "";

                Application.Current.Exit += CurrentOnExit;
            }
            catch (Exception ex)
            {
                Directory.CreateDirectory(Path.Combine(CacheFolderPath, @".\crash-logs"));
                string[] exception =
                {
                    ex.Message };

                File.WriteAllLinesAsync(Path.Combine(CacheFolderPath, @".\crash-logs\latest.log"), exception);
            }
        }

        protected override async void OnInitialized(EventArgs e)
        {
            /// This method sets user data folder and initial URLs for
            /// app windows, as well as performs other startup things

            base.OnInitialized(e);
            var environment = await CoreWebView2Environment.CreateAsync(null, CacheFolderPath);

            await webView.EnsureCoreWebView2Async(environment);
            await appView.EnsureCoreWebView2Async(environment);
            await widgetView.EnsureCoreWebView2Async(environment);

            if (File.Exists(Path.Combine(CacheFolderPath, @".\localserver\config.ini")))
            {
                chatUrl = File.ReadAllText(Path.Combine(CacheFolderPath, @".\localserver\config.ini"));
            } 

            webView.Source = new UriBuilder(chatUrl).Uri;
            appView.Source = new UriBuilder(appUrl).Uri;

            widgetView.Source = new UriBuilder(widgetUrl).Uri;
            widgetView.DefaultBackgroundColor = System.Drawing.Color.Transparent;

            appView.CoreWebView2.WebMessageReceived += HandleWebMessage;
            webView.CoreWebView2.DOMContentLoaded += OnWebViewDOMContentLoaded;
            webView.CoreWebView2.WebMessageReceived += HandleScriptMessage;

            appView.DefaultBackgroundColor = System.Drawing.Color.Transparent;

        }

        private void CurrentOnExit(object sender, ExitEventArgs exitEventArgs)
        {
            /// This method exists to delete the user data folder upon exit
            /// It's deprecated now that the UDF is stored inside AppData/Local/
            /// Keep it, but forget about this.

            try
            {
                if(translator!=null)
                {
                    translator.Dispose();
                }

                // Delete WebView2 user data before application exits
                string? webViewCacheDir = Path.Combine(CacheFolderPath, @".\EBWebView\Default\Cache");
                var webViewProcessId = Convert.ToInt32(webView.CoreWebView2.BrowserProcessId);
                var webViewProcess = Process.GetProcessById(webViewProcessId);

                ClearBrowserData();

                // Shutdown browser with Dispose, and wait for process to exit
                webView.Dispose();
                webViewProcess.WaitForExit(2000);

                //Disabling cache deletion
                //Directory.Delete(webViewCacheDir, true);
            }
            catch (Exception ex)
            {
                // log warning
            }

            Environment.Exit(0);
        }

        /// <summary>
        /// Logic for JS interaction
        /// </summary>
        /// 
        public async void HandleWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            if (args == null)
            {
                return;
            }

            String content = args.TryGetWebMessageAsString();

            dynamic stuff = JsonConvert.DeserializeObject(content);

            switch (stuff.listener.ToString())
            {
                case "toggle-chat":
                    ToggleChat(Boolean.Parse(stuff.value.ToString()));
                    break;

                case "toggle-fullscreen":
                    ToggleFullscreen();
                    break;

                case "toggle-login":
                    ToggleLogin();
                    break;

                case "toggle-update":
                    OpenUrl("https://github.com/sigmacw/sigmanuts-webview2/releases");
                    break;

                case "change-url":
                    string url = stuff.value;
                    webView.CoreWebView2.Navigate(url);
                    webView.CoreWebView2.DOMContentLoaded += OnWebViewDOMContentLoaded;
                    string[] lines =
                        {
                            url
                        };

                    await File.WriteAllLinesAsync(Path.Combine(CacheFolderPath, @".\localserver\config.ini"), lines);

                    break;

                case "change-widget":
                    currentWidget = stuff.value;
                    string[] current =
                        {
                            currentWidget
                        };

                    await File.WriteAllLinesAsync(Path.Combine(CacheFolderPath, @".\localserver\widgets-bili\activeWidget.active"), current);
                    widgetUrl = $"http://localhost:6969/widgets-bili/{currentWidget}/widget.html";
                    widgetView.CoreWebView2.Navigate(widgetUrl);
                    break;

                case "widget-load":
                    string widgetData = stuff.value;
                    string widgetName = stuff.name;
                    bool active = stuff.active;

                    if (!active) break;
                    string[] dataToWrite = { widgetData };
                    try
                    {
                        await File.WriteAllLinesAsync(Path.Combine(CacheFolderPath, $@".\localserver\widgets-bili\{widgetName}\src\data.txt"), dataToWrite);
                    }
                    catch (Exception ex)
                    {
                        Debug.WriteLine(ex.ToString());
                    }          

                    break;

                case "create-widget":
                    string name = stuff.name;
                    string _srcDir = WidgetOperations.CreateWidgetFolder(name);
                    HandleWidgets();
                    break;

                case "populate-widget":
                    string _name = stuff.name;

                    string HTML = stuff.htmlvalue;
                    string CSS = stuff.cssvalue;
                    string JS = stuff.jsvalue;
                    string FIELDS = stuff.fieldsvalue;
                    string DATA = stuff.datavalue;

                    string[] _HTML = { HTML };
                    string[] _CSS = { CSS };
                    string[] _JS = { JS };
                    string[] _FIELDS = { FIELDS };
                    string[] _DATA = { DATA };

                    string widgetDirectory = Path.Combine(CacheFolderPath, @$".\localserver\widgets-bili\{_name}");
                    string srcDirectory = Path.Combine(widgetDirectory, "src");

                    await File.WriteAllLinesAsync(Path.Combine(srcDirectory, @".\html.html"), _HTML);
                    await File.WriteAllLinesAsync(Path.Combine(srcDirectory, @".\css.css"), _CSS);
                    await File.WriteAllLinesAsync(Path.Combine(srcDirectory, @".\js.js"), _JS);
                    await File.WriteAllLinesAsync(Path.Combine(srcDirectory, @".\fields.json"), _FIELDS);
                    await File.WriteAllLinesAsync(Path.Combine(srcDirectory, @".\data.txt"), _DATA);



                    WidgetOperations.CreateWidget(_name, appView);

                    HandleWidgets();
                    widgetUrl = $"http://localhost:6969/widgets-bili/{currentWidget}/widget.html";
                    widgetView.CoreWebView2.Navigate(widgetUrl);
                    break;

                case "refresh-widget":
                    string _name_ = stuff.name;
                    Debug.WriteLine(_name_);
                    WidgetOperations.CreateWidget(_name_, appView);
                    widgetView.CoreWebView2.Navigate(widgetUrl);
                    break;

                case "refresh-widget-list":
                    HandleWidgets();
                    await appView.CoreWebView2.ExecuteScriptAsync($"location.reload();");
                    break;

                case "delete-widget":
                    string __name_ = stuff.name;
                    string widgetDir = Path.Combine(CacheFolderPath, @$".\localserver\widgets-bili\{__name_}");
                    Directory.Delete(widgetDir, true);
                    HandleWidgets();

                    string[] clearActive = { "" };
                    await File.WriteAllLinesAsync(Path.Combine(CacheFolderPath, @".\localserver\widgets-bili\activeWidget.active"), clearActive);
                    await appView.CoreWebView2.ExecuteScriptAsync($"retrieveData().then(updateUI()); $('iframe').attr('src', ``)");
                    break;

                case "test-message":
                    string type = stuff.type;
                    await webView.CoreWebView2.ExecuteScriptAsync("testMessage('" + type + "')");
                    break;

                case "open-folder":
                    Process.Start("explorer.exe",Path.Combine(CacheFolderPath, @".\localserver\widgets-bili\"));
                    break;

                case "request-history":
                    string __history_name = stuff.name;
                    string __history_code = stuff.code;
                    string __history_amount = stuff.amount;

                    webView.CoreWebView2.ExecuteScriptAsync($"sendPastChats('{__history_name}', '{__history_code}', {__history_amount})");
                    break;

                default:
                    break;
            }
        }


        public async void HandleScriptMessage(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            if (args == null)
            {
                return;
            }

            String content = args.TryGetWebMessageAsString();

            dynamic stuff = JsonConvert.DeserializeObject(content);
            if (stuff == null) return;
            if(stuff.listener == "request-translate")
            {
                if (translator == null) return;

                string __source_text = stuff.text;
                string __uid = stuff.uid;
                string __ct = stuff.ct;
                string __ts = stuff.ts;
                string __username = stuff.username;

                AddTranslationBuffer(__source_text, __username, __uid, __ct, __ts);
            }            
         }



        public void ToggleChat(bool active)
        {
            /// Simple function to toggle chat visibility on and off.
            /// 
            /// I am aware that I can change Visibility to Hidden or Collapsed,
            /// it's done by setting Height to 0 for a reason. YouTube chat pauses if not focused.
            /// Do not ask about this.
            if (isChatEnabled == active) return;
            isChatEnabled = active;

            if (isChatEnabled)
            {
                appView.HorizontalAlignment = HorizontalAlignment.Left;
                appView.Width = 51;
                //
                /*
                if (WindowState == WindowState.Maximized)
                {
                    var margin = new Thickness(0, 0, window.ActualWidth - 51, 0);
                    appView.Margin = margin;
                }
                else
                {
                    var margin = new Thickness(0, 0, window.ActualWidth - 51, 0);
                    appView.Margin = margin;
                }*/
            }
            else
            {
                appView.HorizontalAlignment = HorizontalAlignment.Stretch;
                appView.Width = Double.NaN;
                /*
                var margin = new Thickness(0, 0, 0, 0);
                appView.Margin = margin;*/
            }
        }

        public void ToggleLogin()
        {
            ToggleChat(true);
            webView.CoreWebView2.Navigate("https://live.bilibili.com/");
        }

        public async void ToggleFullscreen()
        {
            /// Simple function to toggle fullscreen preview visibility on and off.

            if (!File.Exists(Path.Combine(CacheFolderPath, $@".\localserver\widgets-bili\{currentWidget.Replace("\r\n", string.Empty)}\widget.html")))
            {
                return;
            }

            isPreviewEnabled = !isPreviewEnabled;

            if (isPreviewEnabled)
            {
                if (WindowState == WindowState.Maximized)
                {
                    widgetView.Height = window.ActualHeight - 110;
                }
                else
                {
                    widgetView.Height = window.ActualHeight - 94;
                }
            }
            else
            {
                widgetView.Height = 0;
            }

            await appView.CoreWebView2.ExecuteScriptAsync("$('.fullscreen').toggle('fast');");
        }

        

        public async void HandleWidgets()
        {

            if (File.Exists(Path.Combine(CacheFolderPath, @".\localserver\widgets-bili\activeWidget.active")))
            {
                currentWidget = File.ReadAllText(Path.Combine(CacheFolderPath, @".\localserver\widgets-bili\activeWidget.active"));
            }
            else
            {
                string[] current =
                {
                    ""
                };

                await File.WriteAllLinesAsync(Path.Combine(CacheFolderPath, @".\localserver\widgets-bili\activeWidget.active"), current);
            }

            try
            {
                string[] dirs = Directory.GetDirectories(Path.Combine(CacheFolderPath, @".\localserver\widgets-bili"), "*", SearchOption.TopDirectoryOnly);
                await File.WriteAllLinesAsync(Path.Combine(CacheFolderPath, @$".\localserver\widgets-bili\widgets.ini"), dirs);
            }
            catch (Exception e)
            {
                Debug.WriteLine("The process failed: {0}", e.ToString());
            }

        }


        /// <summary>
        /// Listening for JS events
        /// </summary>
        private async void OnWebViewDOMContentLoaded(object sender, CoreWebView2DOMContentLoadedEventArgs arg)
        {
            /// This function injects scraping script into YouTube live chat. 
            /// 
            webView.CoreWebView2.DOMContentLoaded -= OnWebViewDOMContentLoaded;
            webView.Focus();

            string pathToScript = Path.Combine(
                Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), @".\web-src\js\script.js");
            string contents = File.ReadAllText(pathToScript);
            Debug.WriteLine(contents);
            Console.WriteLine(contents);
            await webView.CoreWebView2.ExecuteScriptAsync(contents);
            await webView.CoreWebView2.ExecuteScriptAsync($"sendTranslationStatus('{translator != null}');");
        }

        private async void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs arg)
        {
            /// I know this function is basically equivalent OnWebViewDOMContentLoaded...
            /// I just couldn't be bothered to generalize these since I'm not gonna be
            /// expanding on any functionality on these events

            webView.NavigationCompleted -= OnNavigationCompleted;
            webView.Focus();

            string pathToScript = System.IO.Path.Combine(
                System.IO.Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location), @".\web-src\js\script.js");
            string contents = File.ReadAllText(pathToScript);

            await webView.CoreWebView2.ExecuteScriptAsync(contents);
        }

        private async void ClearBrowserData()
        {
            CoreWebView2Profile profile;
            if (webView.CoreWebView2 != null)
            {
                profile = appView.CoreWebView2.Profile;
 
                CoreWebView2BrowsingDataKinds dataKinds = (CoreWebView2BrowsingDataKinds)
                                         (CoreWebView2BrowsingDataKinds.DiskCache | CoreWebView2BrowsingDataKinds.AllDomStorage);
                await profile.ClearBrowsingDataAsync(dataKinds);
            }
        }

        /// <summary>
        /// Methods related to the SignalR instance.
        /// Some of the methods are unused, but I'm keeping them just in case. 
        /// Do not suggest to delete those.
        /// </summary>

        private IHost _host;

        private async void InitSignalR()
        {
            _host?.Dispose();
            _host = Host.CreateDefaultBuilder()
                .ConfigureWebHostDefaults(webBuilder => webBuilder
                    .UseUrls("http://localhost:6970")
                    .ConfigureServices(services => services.AddSignalR())
                    //.ConfigureServices(services => services.AddTransient<HubMethods<StreamHub>>())
                    .ConfigureServices(services => services.AddCors(
                            options =>
                            {
                                options.AddDefaultPolicy(
                                    webBuilder =>
                                    {
                                        webBuilder.WithOrigins("http://localhost:6969")
                                        .WithOrigins("https://live.bilibili.com")
                                        .AllowAnyHeader()
                                        .WithMethods("GET", "POST")
                                        .AllowCredentials();
                                    });
                            }
                        ))
                    .Configure(app =>
                    {
                        app.UseCors();
                        app.UseRouting();
                        app.UseEndpoints(endpoints => endpoints.MapHub<StreamHub>("stream"));
                    }))
               .Build();

            await _host.StartAsync();
        }

        private async void StopSignalR()
        {
            if (_host != null)
            {
                await _host.StopAsync();
                _host.Dispose();
            }
        }

        protected override void OnClosing(CancelEventArgs e)
        {
            _host?.Dispose();
            base.OnClosing(e);
        }

        /// <summary>
        /// Interaction logic for MainWindow.xaml
        /// </summary>

        // Can execute
        private void CommandBinding_CanExecute(object sender, CanExecuteRoutedEventArgs e)
        {
            e.CanExecute = true;
        }

        // Minimize
        private void CommandBinding_Executed_Minimize(object sender, ExecutedRoutedEventArgs e)
        {
            SystemCommands.MinimizeWindow(this);
        }

        // Maximize
        private void CommandBinding_Executed_Maximize(object sender, ExecutedRoutedEventArgs e)
        {/*
            isPreviewEnabled = false;
            widgetView.Height = 0;

            isChatEnabled = false;
            var margin = new Thickness(0, 0, 0, 0);
            appView.Margin = margin;*/
            SystemCommands.MaximizeWindow(this);
        }

        // Restore
        private void CommandBinding_Executed_Restore(object sender, ExecutedRoutedEventArgs e)
        {/*
            isPreviewEnabled = false;
            widgetView.Height = 0;

            isChatEnabled = false;
            var margin = new Thickness(0, 5, 0, 0);
            appView.Margin = margin;*/
            SystemCommands.RestoreWindow(this);
        }

        // Close
        private void CommandBinding_Executed_Close(object sender, ExecutedRoutedEventArgs e)
        {
            SystemCommands.CloseWindow(this);
        }

        // State change
        private void MainWindowStateChangeRaised(object sender, EventArgs e)
        {
            if (WindowState == WindowState.Maximized)
            {
                MainWindowBorder.BorderThickness = new Thickness(8);
                RestoreButton.Visibility = Visibility.Visible;
                MaximizeButton.Visibility = Visibility.Collapsed;
            }
            else
            {
                MainWindowBorder.BorderThickness = new Thickness(0);
                RestoreButton.Visibility = Visibility.Collapsed;
                MaximizeButton.Visibility = Visibility.Visible;
            }
        }

        private void OpenUrl(string url)
        {
            try
            {
                Process.Start(url);
            }
            catch
            {
                // hack because of this: https://github.com/dotnet/corefx/issues/10361
                if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                {
                    url = url.Replace("&", "^&");
                    Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                }
                else if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
                {
                    Process.Start("xdg-open", url);
                }
                else if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
                {
                    Process.Start("open", url);
                }
                else
                {
                    throw;
                }
            }
        }
    }

}