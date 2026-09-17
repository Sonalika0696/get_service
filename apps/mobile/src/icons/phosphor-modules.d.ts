// Types the deep Phosphor icon module paths used by ./phosphor.ts.
// The package ships runtime at lib/commonjs but declarations only at
// lib/typescript, so importing an icon by its commonjs path has no colocated
// .d.ts; this wildcard gives each one the correct Icon component type.
declare module 'phosphor-react-native/lib/commonjs/icons/*' {
  import type { Icon } from 'phosphor-react-native';
  const IconComponent: Icon;
  export default IconComponent;
}
