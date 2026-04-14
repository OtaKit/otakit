package com.otakit.updater;

enum BundleStatus {
  BUILTIN("builtin"),
  PENDING("pending"),
  TRIAL("trial"),
  SUCCESS("success"),
  ERROR("error");

  private final String value;

  BundleStatus(String value) {
    this.value = value;
  }

  public String value() {
    return value;
  }

  public static BundleStatus from(String raw) {
    for (BundleStatus status : values()) {
      if (status.value.equals(raw)) {
        return status;
      }
    }
    return PENDING;
  }
}
