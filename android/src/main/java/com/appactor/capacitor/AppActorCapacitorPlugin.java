package com.appactor.capacitor;

import com.appactor.plugin.AppActorPlugin;
import com.appactor.plugin.events.PluginEventListener;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.concurrent.CancellationException;
import kotlin.ResultKt;
import kotlin.coroutines.Continuation;
import kotlin.coroutines.CoroutineContext;
import kotlin.coroutines.intrinsics.IntrinsicsKt;
import kotlinx.coroutines.Dispatchers;
import kotlinx.coroutines.JobKt;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Bridges the AppActor Android SDK to JavaScript.
 *
 * <p>Every SDK call goes through {@code appactor-plugin}'s JSON dispatcher, the same one the Flutter and React Native
 * SDKs use; this class only moves strings across the Capacitor bridge.
 */
@CapacitorPlugin(name = "AppActor")
public class AppActorCapacitorPlugin extends Plugin {

    /** The SDK's "unknown error" code, for a request that ended without a result. */
    private static final int UNFINISHED_ERROR_CODE = 2099;

    /** Every live plugin instance, one per Capacitor bridge. */
    private static final Set<AppActorCapacitorPlugin> PLUGINS = Collections.synchronizedSet(
        Collections.newSetFromMap(new WeakHashMap<>())
    );

    /** {@code AppActorPlugin} has a single listener slot for the whole process; this fans its events out. */
    private static final PluginEventListener FAN_OUT = (eventName, json) -> {
        List<AppActorCapacitorPlugin> plugins;
        synchronized (PLUGINS) {
            plugins = new ArrayList<>(PLUGINS);
        }
        for (AppActorCapacitorPlugin plugin : plugins) {
            plugin.forward(eventName, json);
        }
    };

    @Override
    public void load() {
        AppActorPlugin.INSTANCE.setContext(getContext());
        PLUGINS.add(this);
        claimEvents();
    }

    /**
     * Runs one SDK method. Resolves with {@code { response }}, the dispatcher's JSON envelope ({@code {"success": …}}
     * or {@code {"error": …}}), so SDK errors travel as data rather than rejections.
     */
    @PluginMethod
    public void execute(PluginCall call) {
        String method = call.getString("method");
        if (method == null || method.isEmpty()) {
            call.reject("AppActor.execute needs a method name.");
            return;
        }
        String payload = call.getString("payload", "{}");
        getBridge().executeOnMainThread(() -> dispatch(call, method, payload));
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        // Another AppActor host in the process (a Flutter or React Native module) may have taken or cleared the slot.
        claimEvents();
    }

    @Override
    protected void handleOnDestroy() {
        PLUGINS.remove(this);
        // With no bridge left, hand the slot back, as the React Native SDK does on teardown.
        if (PLUGINS.isEmpty() && AppActorPlugin.INSTANCE.getEventListener() == FAN_OUT) {
            AppActorPlugin.INSTANCE.setEventListener(null);
            AppActorPlugin.INSTANCE.stopEventListening();
        }
        super.handleOnDestroy();
    }

    private void claimEvents() {
        AppActorPlugin.INSTANCE.setActivity(getActivity());
        AppActorPlugin.INSTANCE.setEventListener(FAN_OUT);
        // Installs the SDK's log handler too. On Android 7.x (API 24–25) the SDK's java.time use then needs core
        // library desugaring in the app; see the README.
        AppActorPlugin.INSTANCE.startEventListening();
    }

    /**
     * Runs the dispatcher's suspend entry point on the main thread. Its callback entry point never calls back when a
     * request ends in a CancellationException (a Google Play connection timeout does), which would leave the
     * JavaScript promise pending forever; here every outcome settles the call.
     */
    private void dispatch(PluginCall call, String method, String payload) {
        // Google Play Billing launches its purchase flow from the current Activity.
        AppActorPlugin.INSTANCE.setActivity(getActivity());
        // Main thread plus a job of its own, as the callback entry point gives each request.
        CoroutineContext context = Dispatchers.getMain().plus(JobKt.Job(null));
        Continuation<String> completion = new Continuation<>() {
            @Override
            public CoroutineContext getContext() {
                return context;
            }

            @Override
            public void resumeWith(Object result) {
                respond(call, responseFor(result));
            }
        };
        Object result;
        try {
            result = AppActorPlugin.INSTANCE.execute(method, payload, completion);
        } catch (Throwable failure) {
            result = ResultKt.createFailure(failure);
        }
        if (result != IntrinsicsKt.getCOROUTINE_SUSPENDED()) {
            completion.resumeWith(result);
        }
    }

    /** Resolves on the plugin thread, behind any event the SDK emitted during the call: events go through it too. */
    private void respond(PluginCall call, String response) {
        JSObject result = new JSObject();
        result.put("response", response);
        getBridge().execute(() -> call.resolve(result));
    }

    /**
     * The dispatcher's envelope, or an error envelope for a request that ended without one: transient when it was
     * cancelled, as a Google Play connection timeout is. Fatal VM errors propagate, as they do from the dispatcher's
     * own entry point.
     */
    private static String responseFor(Object result) {
        try {
            ResultKt.throwOnFailure(result);
            return (String) result;
        } catch (VirtualMachineError fatal) {
            throw fatal;
        } catch (Throwable failure) {
            try {
                JSONObject error = new JSONObject()
                    .put("code", UNFINISHED_ERROR_CODE)
                    .put("message", "The AppActor request did not finish.")
                    .put("detail", (failure instanceof CancellationException ? "transient=true, " : "") + failure);
                return new JSONObject().put("error", error).toString();
            } catch (JSONException impossible) {
                throw new IllegalStateException(impossible);
            }
        }
    }

    /** Delivers an SDK event to JavaScript under its own name, only while something there listens to it. */
    private void forward(String eventName, String json) {
        // Capacitor keeps listeners in collections that addListener changes on the plugin thread, so they are read
        // there too; the same thread resolves calls, which keeps an event ahead of the result of the call that
        // caused it.
        getBridge().execute(() -> {
            if (!hasListeners(eventName)) {
                return;
            }
            JSObject data = new JSObject();
            data.put("json", json);
            notifyListeners(eventName, data);
        });
    }
}
