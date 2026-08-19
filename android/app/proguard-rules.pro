# Metrora uses no reflection-based network model in the Android companion.

# ML Kit discovers these barcode/common/vision components from manifest metadata
# and constructs each registrar through its no-argument constructor. Keep only
# those reflective entry points; the rest of the ML Kit implementation remains
# minified.
-keep class com.google.mlkit.vision.barcode.internal.BarcodeRegistrar {
    public <init>();
}
-keep class com.google.mlkit.vision.common.internal.VisionCommonRegistrar {
    public <init>();
}
-keep class com.google.mlkit.common.internal.CommonComponentRegistrar {
    public <init>();
}
