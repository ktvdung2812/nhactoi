package com.nhactoi.window

import android.app.Activity
import android.content.ComponentCallbacks
import android.content.res.Configuration
import android.view.View
import android.view.ViewGroup
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import androidx.window.layout.WindowLayoutInfo
import androidx.window.layout.WindowMetricsCalculator
import com.facebook.react.ReactRootView
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.job
import kotlinx.coroutines.launch

/**
 * Publishes WindowManager's current window and folding feature in React Native dp units.
 *
 * FoldingFeature.bounds is already expressed in the application window coordinate space.
 * We keep the WindowMetrics origin in the payload as well: callers that position a child
 * below an edge-to-edge SafeArea root can translate from window coordinates without losing
 * the original split-window origin.
 */
class NhactoiWindowModule : Module() {
  private companion object {
    const val EVENT_WINDOW_LAYOUT_INFO = "onWindowLayoutInfo"
  }

  private val monitorScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var monitorJob: Job? = null
  private var observing = false
  @Volatile
  private var lastSnapshot: Map<String, Any?>? = null

  override fun definition() = ModuleDefinition {
    Name("NhactoiWindow")
    Events(EVENT_WINDOW_LAYOUT_INFO)

    // A second listener does not trigger OnStartObserving. Expose the most recent
    // complete payload so a newly mounted screen can synchronously catch up.
    Function("getSnapshot") {
      lastSnapshot
    }

    OnStartObserving(EVENT_WINDOW_LAYOUT_INFO) {
      observing = true
      startMonitoringIfPossible()
    }

    OnStopObserving(EVENT_WINDOW_LAYOUT_INFO) {
      observing = false
      stopMonitoring()
    }

    OnActivityEntersForeground {
      startMonitoringIfPossible()
    }

    OnActivityEntersBackground {
      stopMonitoring()
    }

    OnActivityDestroys {
      stopMonitoring()
    }

    OnDestroy {
      stopMonitoring()
      monitorScope.cancel()
    }
  }

  private fun startMonitoringIfPossible() {
    if (!observing || monitorJob?.isActive == true) return

    val activity = appContext.currentActivity ?: return
    val tracker = WindowInfoTracker.getOrCreate(activity)

    monitorJob = monitorScope.launch {
      // Main-thread state owned by this collector; nothing outside the coroutine touches it.
      val collector = coroutineContext.job
      var layoutInfo: WindowLayoutInfo? = null
      var fontScale = activity.resources.configuration.fontScale
      val publish = {
        // Replace the complete payload on every change. In particular, an empty
        // foldingFeatures list clears a fold that disappeared after a resize/rotation.
        val nextSnapshot = layoutInfo?.let { snapshot(activity, it, fontScale) }
        if (collector.isActive && nextSnapshot != null && nextSnapshot != lastSnapshot) {
          lastSnapshot = nextSnapshot
          sendEvent(EVENT_WINDOW_LAYOUT_INFO, nextSnapshot)
        }
      }
      // WindowInfoTracker can emit before the Activity has moved to its new configuration:
      // closing a Pixel Fold reported the cover display's (empty) features with the inner
      // display's WindowMetrics, and nothing re-emitted afterwards. Re-publish once the decor
      // view has been laid out at the new size so the payload pairs the current features with
      // the current window.
      val decorView = activity.window?.decorView
      val sizeListener = View.OnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
        if (right - left != oldRight - oldLeft || bottom - top != oldBottom - oldTop) publish()
      }
      decorView?.addOnLayoutChangeListener(sizeListener)
      val configurationListener = object : ComponentCallbacks {
        override fun onConfigurationChanged(configuration: Configuration) {
          if (fontScale != configuration.fontScale) {
            // RN's DeviceInfo refreshes its cached font scale on resume, but this
            // activity handles font-scale changes without pausing or resuming.
            ((appContext.reactContext as? ReactContext)?.getNativeModule("DeviceInfo") as? LifecycleEventListener)?.onHostResume()
            // RN 0.86 may miss its own requestLayout when display metrics have already
            // changed. Remeasuring the surface updates Fabric's font multiplier and
            // dirties its measurable nodes without remounting the React tree.
            decorView?.post { requestReactRootLayout(decorView) }
          }
          fontScale = configuration.fontScale
          publish()
        }
        override fun onLowMemory() = Unit
      }
      activity.registerComponentCallbacks(configurationListener)
      try {
        tracker.windowLayoutInfo(activity).collectLatest { next ->
          layoutInfo = next
          publish()
        }
      } finally {
        // Cancellation resumes here on the main dispatcher, so the View is touched on its thread.
        decorView?.removeOnLayoutChangeListener(sizeListener)
        activity.unregisterComponentCallbacks(configurationListener)
      }
    }
  }

  private fun requestReactRootLayout(view: View) {
    if (view is ReactRootView) {
      view.requestLayout()
    } else if (view is ViewGroup) {
      for (index in 0 until view.childCount) requestReactRootLayout(view.getChildAt(index))
    }
  }

  private fun stopMonitoring() {
    monitorJob?.cancel()
    monitorJob = null
    // No active collector means this payload may belong to a previous Activity or
    // posture. The next collector will publish a fresh complete snapshot.
    lastSnapshot = null
  }

  private fun snapshot(activity: Activity, layoutInfo: WindowLayoutInfo, fontScale: Float): Map<String, Any?> {
    val metrics = WindowMetricsCalculator.getOrCreate().computeCurrentWindowMetrics(activity)
    val density = metrics.density.toDouble().coerceAtLeast(0.01)
    val bounds = metrics.bounds

    return mapOf(
      "width" to metrics.widthDp.toDouble(),
      "height" to metrics.heightDp.toDouble(),
      "density" to density,
      "fontScale" to fontScale.toDouble(),
      // WindowMetrics.bounds can have a non-zero origin in split-screen/freeform windows.
      "origin" to mapOf(
        "x" to bounds.left.toDouble() / density,
        "y" to bounds.top.toDouble() / density,
      ),
      "windowBounds" to mapOf(
        "left" to bounds.left.toDouble() / density,
        "top" to bounds.top.toDouble() / density,
        "right" to bounds.right.toDouble() / density,
        "bottom" to bounds.bottom.toDouble() / density,
      ),
      "foldingFeatures" to layoutInfo.displayFeatures.mapNotNull { feature ->
        (feature as? FoldingFeature)?.let { foldingFeature ->
          val featureBounds = foldingFeature.bounds
          mapOf(
            "bounds" to mapOf(
              "left" to featureBounds.left.toDouble() / density,
              "top" to featureBounds.top.toDouble() / density,
              "right" to featureBounds.right.toDouble() / density,
              "bottom" to featureBounds.bottom.toDouble() / density,
            ),
            "state" to foldingFeature.state.toString(),
            "orientation" to foldingFeature.orientation.toString(),
            "occlusionType" to foldingFeature.occlusionType.toString(),
            "isSeparating" to foldingFeature.isSeparating,
          )
        }
      },
    )
  }
}
