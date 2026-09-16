/* eslint-disable */
import * as Router from 'expo-router';

export * from 'expo-router';

declare module 'expo-router' {
  export namespace ExpoRouter {
    export interface __routes<T extends string = string> extends Record<string, unknown> {
      StaticRoutes: `/` | `/(tabs)` | `/(tabs)/` | `/(tabs)/bills` | `/(tabs)/notices` | `/(tabs)/profile` | `/(tabs)/requests` | `/_sitemap` | `/bills` | `/bills/history` | `/dev/ui` | `/notices` | `/notices/new` | `/profile` | `/requests` | `/requests/new` | `/vendors`;
      DynamicRoutes: `/bills/${Router.SingleRoutePart<T>}` | `/bills/${Router.SingleRoutePart<T>}/pay` | `/notices/${Router.SingleRoutePart<T>}` | `/requests/${Router.SingleRoutePart<T>}` | `/vendors/${Router.SingleRoutePart<T>}`;
      DynamicRouteTemplate: `/bills/[id]` | `/bills/[id]/pay` | `/notices/[id]` | `/requests/[id]` | `/vendors/[id]`;
    }
  }
}
