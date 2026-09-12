import { prepareNative } from './prepare-native.mjs';

await prepareNative('ios', process.argv[2], process.argv[3]);
