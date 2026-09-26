import AppActorPlugin
import Capacitor
import Foundation
import UIKit

/// Bridges the AppActor iOS SDK to JavaScript.
///
/// Every SDK call goes through `AppActorPlugin`'s JSON dispatcher, the same one the Flutter and
/// React Native SDKs use; this class only moves strings across the Capacitor bridge.
@objc(AppActorCapacitorPlugin)
public class AppActorCapacitorPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppActorCapacitorPlugin"
    public let jsName = "AppActor"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "execute", returnType: CAPPluginReturnPromise)
    ]

    /// Capacitor holds this event until JavaScript listens, so a purchase started in the App Store
    /// isn't lost while the page loads. Every other event goes only to current listeners.
    static let purchaseIntentEvent = "purchase_intent_received"

    /// The serial queue Capacitor runs this plugin's calls and listener changes on.
    var bridgeQueue: DispatchQueue? {
        (bridge as? CapacitorBridge)?.dispatchQueue
    }

    override public func load() {
        AppActorEventFanOut.shared.add(self)
    }

    deinit {
        AppActorEventFanOut.shared.releaseIfUnused()
    }

    /// Runs one SDK method. Resolves with `{ response }`, the dispatcher's JSON envelope
    /// (`{"success": …}` or `{"error": …}`), so SDK errors travel as data rather than rejections.
    @objc func execute(_ call: CAPPluginCall) {
        guard let method = call.getString("method"), !method.isEmpty else {
            call.reject("AppActor.execute needs a method name.")
            return
        }
        // A reset forgets the user, App Store purchases still waiting for JavaScript included: those
        // held now, and those that arrive while it runs.
        let isReset = method == "reset"
        if isReset {
            dropHeldPurchaseIntentsEverywhere()
        }
        let payload = call.getString("payload") ?? "{}"
        AppActorPlugin.shared.execute(method: method, withJsonString: payload) { response in
            // On the queue events are delivered on, so an event the SDK emitted during the call
            // reaches JavaScript before the call's result does.
            self.onBridgeQueue {
                if isReset {
                    self.dropHeldPurchaseIntentsEverywhere()
                }
                call.resolve(["response": response])
            }
        }
    }

    /// Every bridge holds its own copy of an intent. Call on this bridge's queue: this copy goes at
    /// once, the others' on their own queues.
    private func dropHeldPurchaseIntentsEverywhere() {
        dropHeldPurchaseIntents()
        for other in AppActorEventFanOut.shared.livePlugins where other !== self {
            other.onBridgeQueue { other.dropHeldPurchaseIntents() }
        }
    }

    private func dropHeldPurchaseIntents() {
        retainedEventArguments?.removeObject(forKey: Self.purchaseIntentEvent)
    }

    /// Delivers an SDK event to JavaScript under its own name.
    func forward(_ eventName: String, json: String) {
        var data: [String: Any] = ["json": json]
        let isPurchaseIntent = eventName == Self.purchaseIntentEvent
        if isPurchaseIntent {
            // JavaScript drops an intent the native store has already forgotten, by this time.
            data["receivedAt"] = (Date().timeIntervalSince1970 * 1000).rounded()
        }
        onBridgeQueue { [weak self] in
            self?.notifyListeners(eventName, data: data, retainUntilConsumed: isPurchaseIntent)
        }
    }

    /// Capacitor keeps listeners in collections that `addListener` changes on the bridge queue, so
    /// they are read there too.
    private func onBridgeQueue(_ work: @escaping () -> Void) {
        if let queue = bridgeQueue {
            queue.async(execute: work)
        } else {
            work()
        }
    }
}

/// `AppActorPlugin` has a single delegate for the whole process, so it goes to this object, which
/// fans each event out to every live plugin instance (one per Capacitor bridge).
private final class AppActorEventFanOut: NSObject, AppActorPluginDelegate {
    static let shared = AppActorEventFanOut()

    private let lock = NSLock()
    private let plugins = NSHashTable<AppActorCapacitorPlugin>.weakObjects()

    var livePlugins: [AppActorCapacitorPlugin] {
        lock.lock()
        defer { lock.unlock() }
        return plugins.allObjects
    }

    override private init() {
        super.init()
        // Another AppActor host in the process (a Flutter or React Native module) may have taken
        // or cleared the delegate; take it back whenever the app becomes active.
        NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self, !self.livePlugins.isEmpty else { return }
            self.claimEvents()
        }
    }

    func add(_ plugin: AppActorCapacitorPlugin) {
        lock.lock()
        plugins.add(plugin)
        lock.unlock()
        claimEvents()
    }

    /// Hands the delegate back once no bridge is left, as the React Native SDK does on teardown,
    /// so another AppActor host in the process gets its events again.
    func releaseIfUnused() {
        Task { @MainActor in
            guard self.livePlugins.isEmpty, AppActorPlugin.shared.delegate === self else { return }
            AppActorPlugin.shared.delegate = nil
            AppActorPlugin.shared.stopEventListening()
        }
    }

    private func claimEvents() {
        AppActorPlugin.shared.delegate = self
        Task { @MainActor in
            AppActorPlugin.shared.startEventListening()
        }
    }

    func appActorPlugin(_ plugin: AppActorPlugin, didReceiveEvent eventName: String, withJson jsonString: String) {
        for target in livePlugins {
            target.forward(eventName, json: jsonString)
        }
    }
}
