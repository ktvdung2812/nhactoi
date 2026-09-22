package com.nhactoi.window

import android.app.Activity
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import androidx.window.layout.WindowLayoutInfo
import androidx.window.layout.WindowMetricsCalculator
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
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
      tracker.windowLayoutInfo(activity).collectLatest { layoutInfo ->
        // The flow is scoped to this Activity. Re-read metrics for every emission so a
        // resize, rotation, or split-screen drag never leaves stale dimensions in JS.
        val nextSnapshot = snapshot(activity, layoutInfo)
        // Replace the complete payload on every emission. In particular, an empty
        // foldingFeatures list clears a fold that disappeared after a resize/rotation.
        lastSnapshot = nextSnapshot
        sendEvent(EVENT_WINDOW_LAYOUT_INFO, nextSnapshot)
      }
    }
  }

  private fun stopMonitoring() {
    monitorJob?.cancel()
    monitorJob = null
    // No active collector means this payload may belong to a previous Activity or
    // posture. The next collector will publish a fresh complete snapshot.
    lastSnapshot = null
  }

  private fun snapshot(activity: Activity, layoutInfo: WindowLayoutInfo): Map<String, Any?> {
    val metrics = WindowMetricsCalculator.getOrCreate().computeCurrentWindowMetrics(activity)
    val density = metrics.density.toDouble().coerceAtLeast(0.01)
    val bounds = metrics.bounds

    return mapOf(
      "width" to metrics.widthDp.toDouble(),
      "height" to metrics.heightDp.toDouble(),
      "density" to density,
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
