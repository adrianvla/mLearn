package net.kikan.mlearn.ocrqa;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.File;
import java.io.FileOutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/**
 * Real accessibility-driven QA, targeting its own test package rather than
 * instrumenting or replacing mLearn. Begin on a recognized dense source with
 * the Reader's Recognize and Recognition details controls visible.
 */
public final class AndroidOcrCancellation extends Instrumentation {
  private UiAutomation automation;
  private File output;

  @Override public void onCreate(Bundle arguments) {
    super.onCreate(arguments);
    start();
  }

  private static void require(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }

  private AccessibilityNodeInfo find(AccessibilityNodeInfo node, String text) {
    if (node == null) return null;
    if (text.contentEquals(node.getText() == null ? "" : node.getText())
        || text.contentEquals(node.getContentDescription() == null ? "" : node.getContentDescription())) return node;
    for (int i = 0; i < node.getChildCount(); i++) {
      AccessibilityNodeInfo match = find(node.getChild(i), text);
      if (match != null) return match;
    }
    return null;
  }

  private AccessibilityNodeInfo find(String text) {
    return find(automation.getRootInActiveWindow(), text);
  }

  private void click(String text) {
    AccessibilityNodeInfo node = find(text);
    while (node != null && !node.isClickable()) node = node.getParent();
    require(node != null && node.isEnabled() && node.isVisibleToUser(),
      "No visible enabled action: " + text);
    require(node.performAction(AccessibilityNodeInfo.ACTION_CLICK), "Cannot activate: " + text);
  }

  // Subscribe before the action, then inspect the resulting state as well as
  // subsequent events. No sleeps, animation settling or hierarchy polling.
  private void transition(Runnable action, BooleanSupplier done) throws Exception {
    CountDownLatch signal = new CountDownLatch(1);
    AtomicReference<Throwable> failure = new AtomicReference<>();
    Runnable inspect = () -> {
      try { if (done.getAsBoolean()) signal.countDown(); }
      catch (Throwable error) { failure.compareAndSet(null, error); signal.countDown(); }
    };
    automation.setOnAccessibilityEventListener(event -> inspect.run());
    try {
      action.run();
      inspect.run();
      require(signal.await(30, TimeUnit.SECONDS), "Expected accessibility transition did not occur");
      if (failure.get() != null) throw new AssertionError("Accessibility transition failed", failure.get());
    } finally {
      automation.setOnAccessibilityEventListener(null);
    }
  }

  private int revision(AccessibilityNodeInfo node) {
    if (node == null) return -1;
    CharSequence text = node.getText();
    Matcher match = Pattern.compile("recognition revision (\\d+)").matcher(text == null ? "" : text);
    if (match.find()) return Integer.parseInt(match.group(1));
    for (int i = 0; i < node.getChildCount(); i++) {
      int value = revision(node.getChild(i));
      if (value >= 0) return value;
    }
    return -1;
  }

  private int readRevision() throws Exception {
    transition(() -> click("Recognition details"), () -> revision(automation.getRootInActiveWindow()) >= 0);
    int value = revision(automation.getRootInActiveWindow());
    transition(() -> click("Close"), () -> find("Recognize") != null);
    return value;
  }

  private void screenshot(String name) throws Exception {
    Bitmap image = automation.takeScreenshot();
    require(image != null, "Cannot capture actual display");
    try (FileOutputStream file = new FileOutputStream(new File(output, name + ".png"))) {
      require(image.compress(Bitmap.CompressFormat.PNG, 100, file), "Cannot encode display capture");
    } finally { image.recycle(); }
  }

  @Override public void onStart() {
    Bundle receipt = new Bundle();
    JSONObject report = new JSONObject();
    try {
      automation = getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES);
      require(automation != null, "Cannot connect to Android accessibility");
      output = new File(getContext().getExternalFilesDir(null), "ocr-cancellation");
      require(output.isDirectory() || output.mkdirs(), "Cannot create owned evidence directory");
      AccessibilityNodeInfo root = automation.getRootInActiveWindow();
      require(root != null && "net.kikan.mlearn.v3dev".contentEquals(root.getPackageName()),
        "The actual mLearn development app must be foreground");
      int before = readRevision();
      report.put("beforeRevision", before);
      screenshot("before");
      transition(() -> click("Recognize"), () -> find("Recognize page") != null);
      AtomicBoolean cancelled = new AtomicBoolean();
      transition(() -> click("Recognize page"), () -> {
        AccessibilityNodeInfo cancel = find("Cancel recognition");
        if (cancel == null || !cancel.isEnabled()) return false;
        if (!cancel.isVisibleToUser()) {
          require(cancel.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SHOW_ON_SCREEN.getId()),
            "Pending cancellation cannot be brought on screen");
          return false;
        }
        if (cancelled.compareAndSet(false, true)) {
          try { screenshot("pending"); }
          catch (Exception error) { throw new AssertionError("Cannot capture pending work", error); }
          click("Cancel recognition");
        }
        return true;
      });
      require(cancelled.get(), "No real pending cancellation action was activated");
      transition(() -> {}, () -> find("Cancel recognition") == null && find("Recognize") != null);
      screenshot("cancelled");
      int after = readRevision();
      report.put("afterCancellationRevision", after);
      require(after == before, "Cancelled work changed the previously completed recognition");
      transition(() -> click("Recognize"), () -> find("Recognize page") != null);
      AtomicBoolean retryPending = new AtomicBoolean();
      transition(() -> click("Recognize page"), () -> {
        if (find("Cancel recognition") != null) {
          retryPending.set(true);
          return false;
        }
        AccessibilityNodeInfo details = find("Recognition details");
        return retryPending.get() && details != null && details.isEnabled();
      });
      int retried = readRevision();
      report.put("afterRetryRevision", retried);
      // This fixture's selected package adds one projection to its native result.
      // An extra cancelled publication must not hide
      // between the immediate check and completion of the fresh request.
      require(retried == before + 2,
        "Fresh recognition and its package projection were not the only new saved revisions");
      screenshot("retried");
      report.put("passed", true);
      receipt.putString("stream", "ANDROID_OCR_CANCELLATION_VERIFIED\n" + report);
      try (FileOutputStream file = new FileOutputStream(new File(output, "report.json"))) {
        file.write(report.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));
      }
      finish(-1, receipt);
    } catch (Throwable error) {
      receipt.putString("stream", "ANDROID_OCR_CANCELLATION_FAILED\n" + report + "\n" + error);
      finish(0, receipt);
    }
  }
}
