/* eslint-disable */
import * as Router from 'expo-router';

export * from 'expo-router';

declare module 'expo-router' {
  export namespace ExpoRouter {
    export interface __routes<T extends string = string> extends Record<string, unknown> {
      StaticRoutes: `/` | `/(tabs)` | `/(tabs)/` | `/(tabs)/bills` | `/(tabs)/notices` | `/(tabs)/profile` | `/(tabs)/requests` | `/..\..\..\backend\src\generated\prisma\browser` | `/..\..\..\backend\src\generated\prisma\client` | `/..\..\..\backend\src\generated\prisma\commonInputTypes` | `/..\..\..\backend\src\generated\prisma\enums` | `/..\..\..\backend\src\generated\prisma\models` | `/..\..\..\backend\src\generated\prisma\models\AuditLog` | `/..\..\..\backend\src\generated\prisma\models\ConsentGrant` | `/..\..\..\backend\src\generated\prisma\models\Delegation` | `/..\..\..\backend\src\generated\prisma\models\Flat` | `/..\..\..\backend\src\generated\prisma\models\JobBlogPost` | `/..\..\..\backend\src\generated\prisma\models\KycDocument` | `/..\..\..\backend\src\generated\prisma\models\Occupancy` | `/..\..\..\backend\src\generated\prisma\models\Otp` | `/..\..\..\backend\src\generated\prisma\models\Poll` | `/..\..\..\backend\src\generated\prisma\models\PollCommitment` | `/..\..\..\backend\src\generated\prisma\models\Role` | `/..\..\..\backend\src\generated\prisma\models\Session` | `/..\..\..\backend\src\generated\prisma\models\Society` | `/..\..\..\backend\src\generated\prisma\models\User` | `/..\..\..\backend\src\generated\prisma\models\Vendor` | `/..\..\..\backend\src\generated\prisma\models\VendorAccessRequest` | `/..\src\auth\AuthProvider` | `/_sitemap` | `/auth\_layout` | `/auth\sign-in` | `/auth\verify` | `/bills` | `/bills/history` | `/dev/ui` | `/notices` | `/notices/new` | `/profile` | `/requests` | `/requests/new` | `/vendors`;
      DynamicRoutes: `/bills/${Router.SingleRoutePart<T>}` | `/bills/${Router.SingleRoutePart<T>}/pay` | `/notices/${Router.SingleRoutePart<T>}` | `/requests/${Router.SingleRoutePart<T>}` | `/vendors/${Router.SingleRoutePart<T>}`;
      DynamicRouteTemplate: `/bills/[id]` | `/bills/[id]/pay` | `/notices/[id]` | `/requests/[id]` | `/vendors/[id]`;
    }
  }
}
