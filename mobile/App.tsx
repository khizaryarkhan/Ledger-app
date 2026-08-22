import React from "react";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./src/auth/AuthContext";
import { Loading } from "./src/components/ui";
import LoginScreen from "./src/screens/LoginScreen";
import OrgSelectScreen from "./src/screens/OrgSelectScreen";
import RootNavigator from "./src/navigation/RootNavigator";

function Root() {
  const { state } = useAuth();
  switch (state.status) {
    case "loading":
      return <Loading />;
    case "signedOut":
      return <LoginScreen initialError={state.error} />;
    case "orgSelection":
      return <OrgSelectScreen orgs={state.orgs} />;
    case "signedIn":
      return <RootNavigator />;
  }
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <Root />
        </AuthProvider>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
