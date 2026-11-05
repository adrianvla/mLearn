#include <errno.h>
#include <inttypes.h>
#include <libproc.h>
#include <limits.h>
#include <mach/mach.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <sys/sysctl.h>
#include <time.h>

/* Explicit QA prerequisite, never part of a normal Cargo build. */
int main(int argc, char **argv) {
    if (argc != 2) return 64;
    char *end;
    errno = 0;
    long pid = strtol(argv[1], &end, 10);
    if (errno || *end || pid <= 0 || pid > INT_MAX) return 64;
    struct rusage_info_v0 usage = {0};
    if (proc_pid_rusage((int)pid, RUSAGE_INFO_V0, (rusage_info_t *)&usage)) {
        perror("proc_pid_rusage");
        return 70;
    }
    uint64_t total = 0;
    uint32_t pressure = 0;
    struct xsw_usage swap = {0};
    size_t size = sizeof(total);
    if (sysctlbyname("hw.memsize", &total, &size, NULL, 0)) return 70;
    size = sizeof(pressure);
    if (sysctlbyname("kern.memorystatus_vm_pressure_level", &pressure, &size, NULL, 0)) return 70;
    size = sizeof(swap);
    if (sysctlbyname("vm.swapusage", &swap, &size, NULL, 0)) return 70;
    vm_statistics64_data_t vm = {0};
    mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
    vm_size_t page_size = 0;
    mach_port_t host = mach_host_self();
    kern_return_t pages_result = host_page_size(host, &page_size);
    kern_return_t stats_result = host_statistics64(host, HOST_VM_INFO64, (host_info64_t)&vm, &count);
    mach_port_deallocate(mach_task_self(), host);
    if (pages_result != KERN_SUCCESS || stats_result != KERN_SUCCESS) return 70;
    struct timespec now;
    if (clock_gettime(CLOCK_MONOTONIC, &now)) return 70;
    /* Conservative headroom estimate: free + inactive, not active/wired/
       compressed pages. Speculative pages are already included in free_count. */
    uint64_t available = ((uint64_t)vm.free_count + vm.inactive_count) * page_size;
    printf("{\"pid\":%ld,\"timeMs\":%" PRIu64
           ",\"physicalFootprintBytes\":%" PRIu64 ",\"rssBytes\":%" PRIu64
           ",\"totalBytes\":%" PRIu64 ",\"availableBytes\":%" PRIu64
           ",\"pressureLevel\":%" PRIu32 ",\"swapUsedBytes\":%" PRIu64
           ",\"swapOutBytes\":%" PRIu64 "}\n",
           pid, (uint64_t)now.tv_sec * 1000 + (uint64_t)now.tv_nsec / 1000000,
           usage.ri_phys_footprint, usage.ri_resident_size, total, available,
           pressure, swap.xsu_used, vm.swapouts * (uint64_t)page_size);
    return 0;
}
