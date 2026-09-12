// Independent acceptance entry for isolating the native host from Router.
import { registerRootComponent } from 'expo';
import NativeAcceptance from './components/NativeAcceptance';

registerRootComponent(NativeAcceptance);
