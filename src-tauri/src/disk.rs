//! Whole-volume storage facts, for the capacity bar.

use serde::{Deserialize, Serialize};
use sysinfo::Disks;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskInfo {
    pub mount_point: String,
    pub name: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
}

/// Facts for the volume that actually holds `path`.
///
/// Picks the longest matching mount point rather than the first: on a Mac with
/// external drives or a separate `/Users` volume, the shortest match is always
/// `/` and would report the wrong disk.
pub fn for_path(path: &str) -> Option<DiskInfo> {
    let disks = Disks::new_with_refreshed_list();

    let mut best: Option<(usize, DiskInfo)> = None;

    for disk in disks.list() {
        let mount = disk.mount_point().to_string_lossy().to_string();
        if !path.starts_with(&mount) {
            continue;
        }

        let total = disk.total_space();
        let available = disk.available_space();
        let info = DiskInfo {
            mount_point: mount.clone(),
            name: disk.name().to_string_lossy().to_string(),
            total_bytes: total,
            available_bytes: available,
            used_bytes: total.saturating_sub(available),
        };

        if best.as_ref().is_none_or(|(len, _)| mount.len() > *len) {
            best = Some((mount.len(), info));
        }
    }

    best.map(|(_, info)| info)
}
