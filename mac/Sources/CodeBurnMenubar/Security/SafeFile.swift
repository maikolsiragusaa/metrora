import Foundation

/// Symlink-safe file I/O with atomic writes and optional cross-process flock.
///
/// Every cache file we touch (`~/Library/Caches/codeburn-mac/fx-rates.json`,
/// `~/.cache/codeburn/subscription-snapshots.json`, `~/.config/codeburn/config.json`) is a
/// legitimate target for a local-symlink attack: if an attacker plants a symlink from one of
/// those paths to, say, `~/.ssh/config`, a naive `Data.write(to:)` blindly follows the link and
/// clobbers the real file. `O_NOFOLLOW` on the write() refuses the operation instead.
enum SafeFile {
    enum Error: Swift.Error {
        case symlinkDetected(String)
        case openFailed(String, Int32)
        case writeFailed(String, Int32)
        case renameFailed(String, Int32)
        case readFailed(String, Int32)
        case sizeLimitExceeded(String, Int)
    }

    /// Default max bytes when reading untrusted cache files. Prevents a malicious cache file
    /// from exhausting memory in the Swift process.
    static let defaultReadLimit = 8 * 1024 * 1024

    /// Refuses to follow symlinks and writes atomically via a tmp file + rename. `mode` is the
    /// final file permission (0o600 by default so cache files stay user-private).
    static func write(_ data: Data, to path: String, mode: mode_t = 0o600) throws {
        let parent = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(
            atPath: parent,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: NSNumber(value: 0o700)]
        )

        // Reject if the existing file is a symlink. We use lstat so the link itself is
        // inspected, not its target.
        var linkInfo = stat()
        if lstat(path, &linkInfo) == 0, (linkInfo.st_mode & S_IFMT) == S_IFLNK {
            throw Error.symlinkDetected(path)
        }

        let tmpPath = parent + "/.codeburn-" + UUID().uuidString + ".tmp"
        let flags: Int32 = O_CREAT | O_WRONLY | O_EXCL | O_NOFOLLOW
        let fd = Darwin.open(tmpPath, flags, mode)
        guard fd >= 0 else {
            throw Error.openFailed(tmpPath, errno)
        }

        let writeResult: Int = data.withUnsafeBytes { buffer -> Int in
            guard let base = buffer.baseAddress else { return 0 }
            return Darwin.write(fd, base, buffer.count)
        }
        let writeErrno = errno
        fsync(fd)
        Darwin.close(fd)

        guard writeResult == data.count else {
            unlink(tmpPath)
            throw Error.writeFailed(tmpPath, writeErrno)
        }

        if rename(tmpPath, path) != 0 {
            let renameErrno = errno
            unlink(tmpPath)
            throw Error.renameFailed(path, renameErrno)
        }
    }

    /// Refuses to read through a symlink. `maxBytes` bounds the read so a tampered cache file
    /// can't balloon the process.
    static func read(from path: String, maxBytes: Int = defaultReadLimit) throws -> Data {
        var linkInfo = stat()
        guard lstat(path, &linkInfo) == 0 else {
            throw Error.readFailed(path, errno)
        }
        if (linkInfo.st_mode & S_IFMT) == S_IFLNK {
            throw Error.symlinkDetected(path)
        }

        let fd = Darwin.open(path, O_RDONLY | O_NOFOLLOW)
        guard fd >= 0 else {
            throw Error.readFailed(path, errno)
        }
        defer { Darwin.close(fd) }

        let size = Int(linkInfo.st_size)
        if size > maxBytes {
            throw Error.sizeLimitExceeded(path, size)
        }

        var data = Data(count: size)
        let readBytes: Int = data.withUnsafeMutableBytes { buffer -> Int in
            guard let base = buffer.baseAddress else { return 0 }
            return Darwin.read(fd, base, buffer.count)
        }
        guard readBytes >= 0 else {
            throw Error.readFailed(path, errno)
        }
        if readBytes < size {
            data = data.prefix(readBytes)
        }
        return data
    }

    /// Runs `body` while holding an exclusive POSIX advisory lock on `path`. The lock file is
    /// created if missing (with 0o600 permissions) and released on scope exit, so other
    /// codeburn processes (the CLI running in a terminal, say) block on the same file instead
    /// of racing on a shared config.
    static func withExclusiveLock<T>(at path: String, body: () throws -> T) throws -> T {
        let parent = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(
            atPath: parent,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: NSNumber(value: 0o700)]
        )
        let fd = Darwin.open(path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
        guard fd >= 0 else {
            throw Error.openFailed(path, errno)
        }
        defer { Darwin.close(fd) }

        guard flock(fd, LOCK_EX) == 0 else {
            throw Error.openFailed(path, errno)
        }
        defer { _ = flock(fd, LOCK_UN) }

        return try body()
    }
}
