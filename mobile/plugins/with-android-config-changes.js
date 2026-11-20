const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

/**
 * Configuration changes MainActivity handles in-process instead of being destroyed and recreated.
 * Recreation tears down the React surface, so unsent form input (Login, task drafts) is lost.
 *
 * - density: display size changes, and moving between the inner and cover displays of a
 *   foldable whose panels use different densities.
 * - fontScale: the system font size. NhactoiWindow reports it to JS and requests a
 *   surface layout so RN 0.86 propagates the scale through Fabric without remounting.
 */
const HANDLED_CONFIG_CHANGES = ["density", "fontScale"];

module.exports = (config) =>
  withAndroidManifest(config, (mod) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults);
    const changes = new Set((activity.$["android:configChanges"] || "").split("|").filter(Boolean));
    for (const change of HANDLED_CONFIG_CHANGES) changes.add(change);
    activity.$["android:configChanges"] = [...changes].join("|");
    return mod;
  });

module.exports.HANDLED_CONFIG_CHANGES = HANDLED_CONFIG_CHANGES;
