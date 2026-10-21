param(
  [string]$ApplicationPath = "target/debug/mlearn-desktop.exe",
  [string]$OutputDirectory = "test-results/window-materials"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase, System.Windows.Forms, System.Drawing
Add-Type -ReferencedAssemblies UIAutomationClient, UIAutomationTypes, WindowsBase, System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;

public sealed class MaterialCapture {
  public string Theme;
  public int BackdropType;
  public int DarkMode;
  public int Width;
  public int Height;
  public string Image;
}

public static class NativeMaterialQa {
  [StructLayout(LayoutKind.Sequential)]
  public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("dwmapi.dll")] static extern int DwmFlush();
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out int value, int size);

  // Subscribe before triggering the action; no timing sleeps or readiness polls.
  static AutomationElement Wait(AutomationElement root, Func<AutomationElement> query, Action trigger) {
    object gate = new object();
    AutomationElement found = null;
    Exception failure = null;
    bool finished = false;
    using (ManualResetEvent ready = new ManualResetEvent(false)) {
      Action check = delegate {
        lock (gate) {
          if (finished || found != null || failure != null) return;
          try { found = query(); }
          catch (ElementNotAvailableException) { return; }
          catch (Exception error) { failure = error; }
          if (found != null || failure != null) ready.Set();
        }
      };
      StructureChangedEventHandler structure = delegate { check(); };
      AutomationPropertyChangedEventHandler property = delegate { check(); };
      AutomationEventHandler opened = delegate { check(); };
      Automation.AddStructureChangedEventHandler(root, TreeScope.Subtree, structure);
      Automation.AddAutomationPropertyChangedEventHandler(root, TreeScope.Subtree, property,
        AutomationElement.NameProperty, AutomationElement.IsEnabledProperty, AutomationElement.IsOffscreenProperty);
      Automation.AddAutomationEventHandler(WindowPattern.WindowOpenedEvent, root, TreeScope.Subtree, opened);
      try {
        trigger();
        check();
        if (!ready.WaitOne(25000)) throw new TimeoutException("Native UI did not publish the expected control");
        if (failure != null) throw failure;
        return found;
      } finally {
        lock (gate) { finished = true; }
        Automation.RemoveStructureChangedEventHandler(root, structure);
        Automation.RemoveAutomationPropertyChangedEventHandler(root, property);
        Automation.RemoveAutomationEventHandler(WindowPattern.WindowOpenedEvent, root, opened);
      }
    }
  }

  static AutomationElement Find(AutomationElement root, string name, AutomationPattern pattern) {
    AutomationElementCollection matches = root.FindAll(TreeScope.Descendants,
      new PropertyCondition(AutomationElement.NameProperty, name));
    foreach (AutomationElement match in matches) {
      object value;
      if (match.Current.IsEnabled && !match.Current.IsOffscreen &&
          (pattern == null || match.TryGetCurrentPattern(pattern, out value))) return match;
    }
    return null;
  }

  static void Invoke(AutomationElement root, string name) {
    AutomationElement control = Find(root, name, InvokePattern.Pattern);
    if (control == null) throw new InvalidOperationException("Missing native action: " + name);
    ((InvokePattern)control.GetCurrentPattern(InvokePattern.Pattern)).Invoke();
  }

  static AutomationElement Start(string application, out Process process) {
    Process launched = null;
    AutomationElement window = Wait(AutomationElement.RootElement, delegate {
      if (launched == null) return null;
      launched.Refresh();
      return launched.MainWindowHandle == IntPtr.Zero ? null : AutomationElement.FromHandle(launched.MainWindowHandle);
    }, delegate {
      launched = Process.Start(new ProcessStartInfo(application) { UseShellExecute = false });
    });
    process = launched;
    Wait(window, delegate { return Find(window, "Settings", InvokePattern.Pattern); }, delegate {});
    return window;
  }

  static void Settings(AutomationElement window) {
    Wait(window, delegate { return Find(window, "Edit theme JSON", InvokePattern.Pattern); },
      delegate { Invoke(window, "Settings"); });
  }

  static void Save(AutomationElement window, Process process, string document, string theme) {
    Console.WriteLine("Saving native theme: " + theme);
    AutomationElement editor = Wait(window, delegate { return Find(window, "Theme JSON", ValuePattern.Pattern); },
      delegate { Invoke(window, "Edit theme JSON"); });
    process.Refresh();
    SetForegroundWindow(process.MainWindowHandle);
    if (GetForegroundWindow() != process.MainWindowHandle)
      throw new InvalidOperationException("The owned test window cannot receive native input");
    editor.SetFocus();
    string input = document.Replace("\r\n", "\n");
    Exception inputFailure = null;
    Thread typing = new Thread(delegate() {
      try {
        Clipboard.SetText(input);
        SendKeys.SendWait("^a");
        SendKeys.SendWait("^v");
      } catch (Exception error) { inputFailure = error; }
    });
    typing.IsBackground = true;
    typing.SetApartmentState(ApartmentState.STA);
    typing.Start();
    if (!typing.Join(10000)) throw new TimeoutException("Native editor input did not finish");
    if (inputFailure != null) throw inputFailure;
    if (((ValuePattern)editor.GetCurrentPattern(ValuePattern.Pattern)).Current.Value != input)
      throw new InvalidOperationException("Native editor did not receive the complete theme");
    // Custom palettes are not built-in selector options; their saved state
    // closes the editor and restores the enabled placeholder selector.
    string selection = theme == "Slate" ? "Select" : theme;
    Wait(window, delegate { return Find(window, "Select theme: " + selection, null); },
      delegate { Invoke(window, "Save custom theme"); });
  }

  static MaterialCapture Capture(Process process, string theme, string path, bool translucent, bool dark) {
    process.Refresh();
    IntPtr window = process.MainWindowHandle;
    int backdrop, appearance;
    int backdropResult = DwmGetWindowAttribute(window, 38, out backdrop, sizeof(int));
    int appearanceResult = DwmGetWindowAttribute(window, 20, out appearance, sizeof(int));
    SetForegroundWindow(window);
    if (GetForegroundWindow() != window || DwmFlush() != 0)
      throw new InvalidOperationException("No composited foreground window is available");
    Rect rect;
    if (!GetWindowRect(window, out rect)) throw new InvalidOperationException("Cannot measure native window");
    int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
    if (width <= 0 || height <= 0) throw new InvalidOperationException("Native window is empty");
    using (Bitmap image = new Bitmap(width, height))
    using (Graphics graphics = Graphics.FromImage(image)) {
      graphics.CopyFromScreen(rect.Left, rect.Top, 0, 0, image.Size);
      image.Save(path, ImageFormat.Png);
    }
    if (backdropResult != 0 || appearanceResult != 0)
      throw new InvalidOperationException("DWM material inspection is unavailable: " + backdropResult + ", " + appearanceResult);
    if (backdrop != (translucent ? 2 : 1) || appearance != (dark ? 1 : 0))
      throw new InvalidOperationException("Actual DWM state for " + theme + ": backdrop=" + backdrop + ", dark=" + appearance);
    return new MaterialCapture { Theme = theme, BackdropType = backdrop, DarkMode = appearance,
      Width = width, Height = height, Image = path };
  }

  static void Close(AutomationElement window, Process process) {
    ((WindowPattern)window.GetCurrentPattern(WindowPattern.Pattern)).Close();
    if (!process.WaitForExit(15000)) throw new TimeoutException("Owned native app did not exit");
  }

  public static List<MaterialCapture> Run(string application, string output, string quartz, string dark, string slate) {
    Directory.CreateDirectory(output);
    List<MaterialCapture> captures = new List<MaterialCapture>();
    Process process = null;
    try {
      AutomationElement window = Start(application, out process);
      Settings(window);
      captures.Add(Capture(process, "Quartz", Path.Combine(output, "quartz.png"), true, false));
      Save(window, process, dark, "Dark Quartz");
      captures.Add(Capture(process, "Dark Quartz", Path.Combine(output, "dark-quartz.png"), true, true));
      Save(window, process, slate, "Slate");
      captures.Add(Capture(process, "Slate", Path.Combine(output, "opaque-slate.png"), false, true));
      Save(window, process, dark, "Dark Quartz");
      Close(window, process);
      process = null;
      window = Start(application, out process);
      captures.Add(Capture(process, "Restored Dark Quartz", Path.Combine(output, "restored-dark-quartz.png"), true, true));
      Settings(window);
      Save(window, process, quartz, "Quartz");
      captures.Add(Capture(process, "Restored Quartz", Path.Combine(output, "restored-quartz.png"), true, false));
      Close(window, process);
      process = null;
      return captures;
    } finally {
      if (process != null && !process.HasExited) process.Kill();
    }
  }
}
'@
$quartz = Get-Content resources/themes/quartz.json -Raw
$dark = Get-Content resources/themes/dark-quartz.json -Raw
$slate = $dark | ConvertFrom-Json
$slate.id = "mlearn.slate"
$slate.name = "Slate"
$slate.colors.background = "#15191F"
$slate.colors.surface = "#20262E"
$slate.colors.text = "#EDF0F5"
$slate.colors.muted = "#BAC2CE"
$slate.colors.accent = "#99BEFF"
$slate.colors.onAccent = "#15243C"
$slate.colors.border = "#414B5A"
$output = [IO.Path]::GetFullPath($OutputDirectory)
$application = [IO.Path]::GetFullPath($ApplicationPath)
$captures = [NativeMaterialQa]::Run($application, $output, $quartz, $dark, ($slate | ConvertTo-Json -Depth 10))
$captures | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $output "native-materials.json")
Write-Output "Native Windows material transitions and startup restoration passed."
