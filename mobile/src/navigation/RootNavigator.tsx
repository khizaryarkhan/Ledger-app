import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./types";
import { colors } from "../theme";

import HomeScreen from "../screens/HomeScreen";
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
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Prime Accountax" }} />
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
