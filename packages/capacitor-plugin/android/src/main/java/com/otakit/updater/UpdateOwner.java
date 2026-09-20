package com.otakit.updater;

import java.util.concurrent.Callable;
import java.util.concurrent.CancellationException;
import java.util.function.BooleanSupplier;

/** Checked on the main thread together with state publication and activation. */
final class UpdateOwner {

  private final BooleanSupplier isAvailable;
  private boolean closed;

  UpdateOwner(BooleanSupplier isAvailable) {
    this.isAvailable = isAvailable;
  }

  void close() {
    closed = true;
  }

  <T> T run(Callable<T> action) throws Exception {
    if (closed || !isAvailable.getAsBoolean()) throw new CancellationException(
      "Updater bridge is no longer active"
    );
    return action.call();
  }
}
