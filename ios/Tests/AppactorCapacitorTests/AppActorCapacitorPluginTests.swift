import Capacitor
import XCTest

@testable import AppactorCapacitor

final class AppActorCapacitorPluginTests: XCTestCase {
    func testMetadataMatchesTheJavaScriptSide() {
        let plugin = AppActorCapacitorPlugin()

        XCTAssertEqual(plugin.jsName, "AppActor")
        XCTAssertEqual(plugin.identifier, "AppActorCapacitorPlugin")
        XCTAssertEqual(plugin.pluginMethods.map(\.name), ["execute"])
        XCTAssertEqual(plugin.pluginMethods.first?.returnType, CAPPluginReturnPromise)
    }

    func testExecuteResolvesWithTheDispatcherEnvelope() throws {
        let response = try execute(["method": "get_sdk_version", "payload": "{}"])

        let envelope = try XCTUnwrap(decode(response))
        XCTAssertNotNil(envelope["success"] as? String)
        XCTAssertNil(envelope["error"])
    }

    func testUnknownMethodsResolveWithAnErrorEnvelope() throws {
        let response = try execute(["method": "no_such_method"])

        let error = try XCTUnwrap(decode(response)?["error"] as? [String: Any])
        XCTAssertEqual(error["code"] as? Int, 1003)
    }

    func testExecuteRejectsWithoutAMethod() throws {
        let rejected = expectation(description: "rejected")
        let call = try makeCall(
            onResolve: { _ in XCTFail("A call without a method must not resolve.") },
            onReject: { error in
                XCTAssertEqual(error?.message, "AppActor.execute needs a method name.")
                rejected.fulfill()
            }
        )

        AppActorCapacitorPlugin().execute(call)

        wait(for: [rejected], timeout: 5)
    }

    func testEventsReachJavaScriptAsJson() throws {
        let plugin = makeListenable()
        var delivered: [String: Any]?
        plugin.addEventListener("customer_info_updated", listener: try listener { delivered = $0 })

        plugin.forward("customer_info_updated", json: #"{"app_user_id":"user_1"}"#)

        XCTAssertEqual(delivered?["json"] as? String, #"{"app_user_id":"user_1"}"#)
    }

    func testEventsReachOnlyListenersOfTheirOwnName() throws {
        let plugin = makeListenable()
        var events = 0
        var logs = 0
        plugin.addEventListener("customer_info_updated", listener: try listener { _ in events += 1 })

        plugin.forward("sdk_log", json: "{}")
        plugin.addEventListener("sdk_log", listener: try listener { _ in logs += 1 })
        plugin.forward("sdk_log", json: "{}")

        XCTAssertEqual(events, 0)
        XCTAssertEqual(logs, 1)
    }

    func testPurchaseIntentsWaitForAListener() throws {
        let plugin = makeListenable()
        var delivered: [String: Any]?

        plugin.forward("purchase_intent_received", json: #"{"intent_id":"intent_1"}"#)
        plugin.addEventListener("purchase_intent_received", listener: try listener { delivered = $0 })

        XCTAssertEqual(delivered?["json"] as? String, #"{"intent_id":"intent_1"}"#)
        let receivedAt = try XCTUnwrap(delivered?["receivedAt"] as? Double)
        XCTAssertEqual(receivedAt, Date().timeIntervalSince1970 * 1000, accuracy: 5_000)
    }

    func testResetDropsPurchaseIntentsHeldByEveryBridge() throws {
        let caller = makeListenable()
        let other = makeListenable()
        caller.load()
        other.load()
        var delivered = false
        other.forward("purchase_intent_received", json: #"{"intent_id":"intent_1"}"#)

        _ = try execute(["method": "reset"], on: caller)
        other.addEventListener("purchase_intent_received", listener: try listener { _ in delivered = true })

        XCTAssertFalse(delivered)
    }

    func testResetDropsPurchaseIntentsStillWaiting() throws {
        let plugin = makeListenable()
        var delivered = false
        plugin.forward("purchase_intent_received", json: #"{"intent_id":"intent_1"}"#)

        _ = try execute(["method": "reset"], on: plugin)
        plugin.addEventListener("purchase_intent_received", listener: try listener { _ in delivered = true })

        XCTAssertFalse(delivered)
    }

    func testResetAlsoDropsPurchaseIntentsThatArriveWhileItRuns() throws {
        let plugin = makeListenable(QueuedPlugin())
        let resolved = expectation(description: "reset resolved")
        let call = try makeCall(options: ["method": "reset"], onResolve: { _ in resolved.fulfill() })

        plugin.queue.suspend()
        plugin.execute(call)
        plugin.forward("purchase_intent_received", json: #"{"intent_id":"intent_1"}"#)
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.3))
        plugin.queue.resume()
        wait(for: [resolved], timeout: 5)

        var delivered = false
        plugin.queue.sync {
            plugin.addEventListener("purchase_intent_received", listener: try! self.listener { _ in delivered = true })
        }
        XCTAssertFalse(delivered)
    }

    func testCallResultsReachJavaScriptAfterEventsEmittedDuringTheCall() throws {
        let plugin = makeListenable(QueuedPlugin())
        let lock = NSLock()
        var order: [String] = []
        let record = { (entry: String) in
            lock.lock()
            order.append(entry)
            lock.unlock()
        }
        plugin.addEventListener("customer_info_updated", listener: try listener { _ in record("event") })
        let resolved = expectation(description: "resolved")
        let call = try makeCall(options: ["method": "get_sdk_version"], onResolve: { _ in
            record("result")
            resolved.fulfill()
        })

        plugin.queue.suspend()
        plugin.execute(call)
        plugin.forward("customer_info_updated", json: "{}")
        // Let the call finish on the main actor while the bridge queue still holds the event.
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.3))
        plugin.queue.resume()

        wait(for: [resolved], timeout: 5)
        XCTAssertEqual(order, ["event", "result"])
    }

    // MARK: - Helpers

    private func execute(_ options: [String: Any], on plugin: AppActorCapacitorPlugin = AppActorCapacitorPlugin()) throws -> String {
        let resolved = expectation(description: "resolved")
        var response: String?
        let call = try makeCall(options: options, onResolve: { result in
            response = result?.data?["response"] as? String
            resolved.fulfill()
        })

        plugin.execute(call)

        wait(for: [resolved], timeout: 5)
        return try XCTUnwrap(response)
    }

    /// A plugin outside a bridge has no listener storage until Capacitor loads it; give it some.
    private func makeListenable<Plugin: AppActorCapacitorPlugin>(_ plugin: Plugin = AppActorCapacitorPlugin()) -> Plugin {
        plugin.eventListeners = [:]
        plugin.retainedEventArguments = [:]
        return plugin
    }

    private func listener(_ onEvent: @escaping ([String: Any]) -> Void) throws -> CAPPluginCall {
        try makeCall(
            "addListener",
            onResolve: { result in onEvent(result?.data ?? [:]) },
            onReject: { _ in XCTFail("A listener must not be rejected.") }
        )
    }

    private func makeCall(
        _ methodName: String = "execute",
        options: [String: Any] = [:],
        onResolve: @escaping (CAPPluginCallResult?) -> Void,
        onReject: @escaping (CAPPluginCallError?) -> Void = { error in
            XCTFail("Unexpected rejection: \(error?.message ?? "")")
        }
    ) throws -> CAPPluginCall {
        try XCTUnwrap(
            CAPPluginCall(
                callbackId: UUID().uuidString,
                methodName: methodName,
                options: options,
                success: { result, _ in onResolve(result) },
                error: { error in onReject(error) }
            )
        )
    }

    private func decode(_ json: String) -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any]
    }
}

/// Runs the plugin's bridge-queue work on a queue the test can hold.
private final class QueuedPlugin: AppActorCapacitorPlugin {
    let queue = DispatchQueue(label: "AppActorCapacitorPluginTests.bridge")

    override var bridgeQueue: DispatchQueue? { queue }
}
