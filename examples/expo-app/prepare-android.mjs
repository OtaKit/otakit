import { prepareNative } from './prepare-native.mjs';

await prepareNative('android', process.argv[2], process.argv[3]);
