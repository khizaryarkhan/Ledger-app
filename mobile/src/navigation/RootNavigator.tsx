import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { RootStackParamList, TabParamList } from "./types";
import { colors } from "../theme";
import { useAlertBadge } from "../hooks/useAlertBadge";

import HomeScreen from "../screens/HomeScreen";
import TodayScreen from "../screens/TodayScreen";
import AlertsScreen from "../screens/AlertsScreen";
import ProfileScreen from "../screens/ProfileScreen";

import ReceivablesOverviewScreen from "../screens/receivables/ReceivablesOverviewScreen";
import InvoiceListScreen from "../screens/receivables/InvoiceListScreen";
import InvoiceDetailScreen from "../screens/receivables/InvoiceDetailScreen";
import EscalationsScreen from "../screens/receivables/EscalationsScreen";
import ReceivableCustomersScreen from "../screens/receivables/ReceivableCustomersScreen";

import ReceivingListScreen from "../screens/receiving/ReceivingListScreen";
import ReceivingDetailScreen from "../screens/receiving/ReceivingDetailScreen";
import ReceivingAdHocScreen from "../screens/receiving/ReceivingAdHocScreen";
import ProductionListScreen from "../screens/production/ProductionListScreen";
import ProductionDetailScreen from "../screens/production/ProductionDetailScreen";
import ShippingListScreen from "../screens/shipping/ShippingListScreen";
import ShippingDetailScreen from "../screens/shipping/ShippingDetailScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

/**
 * The bottom bar. Four tabs, chosen for what a phone is actually for:
 *
 *   Home     — the departments, i.e. everything the role can do
 *   Today    — the prioritised work queue: what to do next
 *   Alerts   — what changed that you didn't do yourself
 *   Profile  — who/where you're signed in as, and out
 *
 * Deliberately not a tab: settings (a desk job), search (lives in the lists it
 * searches), and a "+" compose button — nothing in this app is created from
 * nothing; every action starts from a document or an invoice.
 */
function Tabs() {
  const badge = useAlertBadge();

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{
          title: "Home",
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="TodayTab"
        component={TodayScreen}
        options={{
          title: "Today",
          headerTitle: "Today",
          tabBarIcon: ({ color, size }) => <Ionicons name="checkmark-done-outline" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="AlertsTab"
        component={AlertsScreen}
        options={{
          title: "Alerts",
          headerTitle: "Alerts",
          tabBarIcon: ({ color, size }) => <Ionicons name="notifications-outline" size={size} color={color} />,
          // Only surfaces things gone wrong — a badge for "you have invoices"
          // would be permanently lit and therefore ignored.
          tabBarBadge: badge > 0 ? (badge > 99 ? "99+" : badge) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.danger, fontSize: 10 },
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          title: "Profile",
          headerTitle: "Profile",
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />

        <Stack.Screen name="ReceivablesOverview" component={ReceivablesOverviewScreen} options={{ title: "Receivables" }} />
        <Stack.Screen name="ReceivablesInvoices" component={InvoiceListScreen} options={{ title: "Invoices" }} />
        <Stack.Screen name="ReceivablesInvoiceDetail" component={InvoiceDetailScreen} options={{ title: "Invoice" }} />
        <Stack.Screen name="ReceivablesEscalations" component={EscalationsScreen} options={{ title: "My escalations" }} />
        <Stack.Screen name="ReceivablesCustomers" component={ReceivableCustomersScreen} options={{ title: "Customers" }} />

        <Stack.Screen name="ReceivingList" component={ReceivingListScreen} options={{ title: "Receiving" }} />
        <Stack.Screen name="ReceivingDetail" component={ReceivingDetailScreen} options={{ title: "Post receipt" }} />
        <Stack.Screen name="ReceivingAdHoc" component={ReceivingAdHocScreen} options={{ title: "Receive without a PO" }} />
        <Stack.Screen name="ProductionList" component={ProductionListScreen} options={{ title: "Production" }} />
        <Stack.Screen name="ProductionDetail" component={ProductionDetailScreen} options={{ title: "Build production run" }} />
        <Stack.Screen name="ShippingList" component={ShippingListScreen} options={{ title: "Shipping" }} />
        <Stack.Screen name="ShippingDetail" component={ShippingDetailScreen} options={{ title: "Post shipment" }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
