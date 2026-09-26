package com.appactor.capacitor;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.junit.Test;

public class AppActorCapacitorPluginTest {

    @Test
    public void registersUnderTheJavaScriptName() {
        CapacitorPlugin plugin = AppActorCapacitorPlugin.class.getAnnotation(CapacitorPlugin.class);

        assertNotNull(plugin);
        assertEquals("AppActor", plugin.name());
    }

    @Test
    public void exposesExecuteAsAPromise() throws NoSuchMethodException {
        PluginMethod execute = AppActorCapacitorPlugin.class.getMethod("execute", PluginCall.class).getAnnotation(
            PluginMethod.class
        );

        assertNotNull(execute);
        assertEquals(PluginMethod.RETURN_PROMISE, execute.returnType());
    }
}
