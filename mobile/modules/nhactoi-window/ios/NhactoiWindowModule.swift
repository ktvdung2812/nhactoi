import ExpoModulesCore
import UIKit

private let windowLayoutInfoEvent = "onWindowLayoutInfo"

/**
 Publishes the app window and the iPhone Duo fold in the payload shape the Android module uses.

 iOS reports the fold as a `.division` reserved region (iOS 27.1+). Apple documents that UIKit
 tracks the regions a view reads in `updateConstraints()` and runs it again when they change, so a
 transparent probe view that covers the key window reads them there. Every value is in points,
 which React Native uses as its density-independent unit on iOS.
 */
public final class NhactoiWindowModule: Module {
  private let snapshotLock = NSLock()
  private var latestSnapshot: [String: Any]?
  // Main-thread state.
  private var observing = false
  private var probe: NhactoiWindowProbeView?

  public func definition() -> ModuleDefinition {
    Name("NhactoiWindow")
    Events(windowLayoutInfoEvent)

    // A second JS listener does not trigger OnStartObserving. Expose the latest complete payload
    // so a newly mounted screen can synchronously catch up.
    Function("getSnapshot") { () -> [String: Any]? in
      self.snapshotLock.lock()
      defer { self.snapshotLock.unlock() }
      return self.latestSnapshot
    }

    OnStartObserving(windowLayoutInfoEvent) {
      self.onMain { module in
        module.observing = true
        module.attachProbeIfPossible()
      }
    }

    OnStopObserving(windowLayoutInfoEvent) {
      self.onMain { module in
        module.observing = false
        module.detachProbe()
      }
    }

    // The scene can be disconnected and reconnected (for example when iPhone Duo moves the app
    // between its displays); re-attach to whichever window is current.
    OnAppBecomesActive {
      self.onMain { module in
        module.attachProbeIfPossible()
        module.probe?.refresh()
      }
    }

    OnDestroy {
      let probe = self.probe
      DispatchQueue.main.async {
        MainActor.assumeIsolated { probe?.removeFromSuperview() }
      }
    }
  }

  private func onMain(_ work: @escaping @MainActor (NhactoiWindowModule) -> Void) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      MainActor.assumeIsolated { work(self) }
    }
  }

  @MainActor
  private func attachProbeIfPossible() {
    guard observing, let window = currentWindow() else { return }
    if let probe, probe.window === window { return }
    probe?.removeFromSuperview()
    let next = NhactoiWindowProbeView(frame: window.bounds)
    next.onSnapshot = { [weak self] snapshot in self?.publish(snapshot) }
    // Behind the React root view: the probe never draws or receives touches.
    window.insertSubview(next, at: 0)
    probe = next
  }

  @MainActor
  private func detachProbe() {
    probe?.removeFromSuperview()
    probe = nil
    // No observer means the cached payload may describe an old window or posture.
    snapshotLock.lock()
    latestSnapshot = nil
    snapshotLock.unlock()
  }

  @MainActor
  private func currentWindow() -> UIWindow? {
    if let window = appContext?.utilities?.currentViewController()?.view.window {
      return window
    }
    return SceneGeometry.keyWindow()
  }

  private func publish(_ snapshot: [String: Any]) {
    snapshotLock.lock()
    latestSnapshot = snapshot
    snapshotLock.unlock()
    sendEvent(windowLayoutInfoEvent, snapshot)
  }
}

/// A transparent, non-interactive view that covers the window and reports its geometry.
final class NhactoiWindowProbeView: UIView {
  var onSnapshot: (([String: Any]) -> Void)?
  private var lastSnapshot: NSDictionary?
  private var lastSize: CGSize = .zero
  private var hingeInteraction: UIInteraction?

  override class var requiresConstraintBasedLayout: Bool { true }

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    accessibilityElementsHidden = true
    backgroundColor = .clear
    autoresizingMask = [.flexibleWidth, .flexibleHeight]
    installHingeInteraction()
    if #available(iOS 17.0, *) {
      registerForTraitChanges([UITraitDisplayScale.self]) { (view: NhactoiWindowProbeView, _) in
        view.refresh()
      }
    }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard let window else { return }
    frame = window.bounds
    refresh()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    // A window resize (Stage Manager, Split View, iPhone Duo fold/unfold, rotation) changes the
    // probe's bounds through its autoresizing mask.
    if bounds.size != lastSize {
      lastSize = bounds.size
      refresh()
    }
  }

  override func updateConstraints() {
    // Reading the reserved regions here is what lets UIKit call this method again when the
    // fold becomes active (partially open) or inactive (fully open).
    publishIfChanged()
    super.updateConstraints()
  }

  /// Schedules a constraint pass, which re-reads the reserved regions where UIKit tracks them.
  func refresh() {
    setNeedsUpdateConstraints()
    publishIfChanged()
  }

  private func installHingeInteraction() {
    #if compiler(>=6.4) && canImport(UIKit, _version: 9127.1)
    if #available(iOS 27.1, *) {
      // Hinge status changes and region activation arrive close together; either one triggers a
      // fresh read so the payload never lags the posture.
      let interaction = UIHingeInteraction { [weak self] _, _ in
        self?.refresh()
      }
      addInteraction(interaction)
      hingeInteraction = interaction
    }
    #endif
  }

  private func publishIfChanged() {
    guard let window, bounds.width > 0, bounds.height > 0 else { return }
    let snapshot = makeSnapshot(in: window)
    let dictionary = snapshot as NSDictionary
    if let lastSnapshot, lastSnapshot.isEqual(dictionary) { return }
    lastSnapshot = dictionary
    onSnapshot?(snapshot)
  }

  private func makeSnapshot(in window: UIWindow) -> [String: Any] {
    let scale = SceneGeometry.displayScale(for: self)
    let size = window.bounds.size
    let screenSpace = window.windowScene?.screen.coordinateSpace
    // In Stage Manager the window has a non-zero origin on the display.
    let frame = screenSpace.map { window.convert(window.bounds, to: $0) } ?? window.frame
    return [
      "width": Double(size.width),
      "height": Double(size.height),
      "density": Double(scale),
      "origin": ["x": Double(frame.minX), "y": Double(frame.minY)],
      "windowBounds": rect(frame),
      "foldingFeatures": foldingFeatures(in: window),
    ]
  }

  private func foldingFeatures(in window: UIWindow) -> [[String: Any]] {
    #if compiler(>=6.4) && canImport(UIKit, _version: 9127.1)
    if #available(iOS 27.1, *) {
      // Include inactive divisions so a fully open fold is reported as FLAT, like Android.
      return reservedRegions(kind: .division, options: .includeInactive).map { region in
        // The frame is in this view's coordinate space and already includes Apple's margins
        // around the fold line. The probe covers the window, but convert to be exact.
        let bounds = convert(region.frame, to: window)
        return [
          "bounds": rect(bounds),
          "state": region.isActive ? "HALF_OPENED" : "FLAT",
          "orientation": bounds.height >= bounds.width ? "VERTICAL" : "HORIZONTAL",
          // iPhone Duo has one continuous display; nothing is hidden under the fold.
          "occlusionType": "NONE",
          // Apple: a division is active only when the device is partially open; content that
          // crosses an active division is hard to read and use.
          "isSeparating": region.isActive,
        ]
      }
    }
    #endif
    return []
  }

  private func rect(_ rect: CGRect) -> [String: Double] {
    [
      "left": Double(rect.minX),
      "top": Double(rect.minY),
      "right": Double(rect.maxX),
      "bottom": Double(rect.maxY),
    ]
  }
}
