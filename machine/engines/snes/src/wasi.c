/* The system the engine's libc sees, defined inside the module so that
   nothing comes in from outside. libc reaches for these from paths the
   machine never takes for its result (C++ streams, std::chrono, time()),
   and each answer is a constant:

   - the clock reads 0 (1970-01-01) and never moves;
   - the environment is empty;
   - there are no files: reads and seeks fail, writes are swallowed.

   So a cartridge with a real-time clock (S-RTC, SPC7110) sees the same
   date on every peer. */
#include <wasi/api.h>

__wasi_errno_t __wasi_clock_time_get(__wasi_clockid_t id, __wasi_timestamp_t precision, __wasi_timestamp_t *time) {
  *time = 0;
  return __WASI_ERRNO_SUCCESS;
}

__wasi_errno_t __wasi_environ_sizes_get(__wasi_size_t *count, __wasi_size_t *size) {
  *count = 0;
  *size = 0;
  return __WASI_ERRNO_SUCCESS;
}

__wasi_errno_t __wasi_environ_get(uint8_t **environ, uint8_t *buf) {
  return __WASI_ERRNO_SUCCESS;
}

__wasi_errno_t __wasi_fd_write(__wasi_fd_t fd, const __wasi_ciovec_t *iovs, size_t n, __wasi_size_t *written) {
  __wasi_size_t total = 0;
  for (size_t i = 0; i < n; i++) total += iovs[i].buf_len;
  *written = total;
  return __WASI_ERRNO_SUCCESS;
}

__wasi_errno_t __wasi_fd_read(__wasi_fd_t fd, const __wasi_iovec_t *iovs, size_t n, __wasi_size_t *read) {
  *read = 0;
  return __WASI_ERRNO_BADF;
}

__wasi_errno_t __wasi_fd_seek(__wasi_fd_t fd, __wasi_filedelta_t offset, __wasi_whence_t whence, __wasi_filesize_t *position) {
  return __WASI_ERRNO_BADF;
}

__wasi_errno_t __wasi_fd_close(__wasi_fd_t fd) {
  return __WASI_ERRNO_BADF;
}
