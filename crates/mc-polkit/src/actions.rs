/// PolicyKit action identifiers for CeyMail Mission Control operations.
/// These correspond to the actions defined in deploy/polkit/com.ceymail.mc.policy

/// Action ID for managing mail server services (start/stop/restart)
pub const ACTION_MANAGE_SERVICES: &str = "com.ceymail.mc.manage-services";

/// Action ID for modifying mail server configuration files
pub const ACTION_MODIFY_CONFIG: &str = "com.ceymail.mc.modify-config";

/// Action ID for installing system packages
pub const ACTION_INSTALL_PACKAGES: &str = "com.ceymail.mc.install-packages";

/// Action ID for managing SSL/TLS certificates
pub const ACTION_MANAGE_CERTIFICATES: &str = "com.ceymail.mc.manage-certificates";

/// All action IDs
pub const ALL_ACTIONS: &[&str] = &[
    ACTION_MANAGE_SERVICES,
    ACTION_MODIFY_CONFIG,
    ACTION_INSTALL_PACKAGES,
    ACTION_MANAGE_CERTIFICATES,
];
