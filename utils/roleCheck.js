const config = require('../config');

function hasRoleByIdOrName(member, roleId, roleName) {
    if (!member || !member.roles || !member.roles.cache) {
        return false;
    }

    if (roleId && member.roles.cache.has(roleId)) {
        return true;
    }

    if (roleName) {
        return member.roles.cache.some(role => role.name === roleName);
    }

    return false;
}

function userHasPlayerRole(member) {
    return hasRoleByIdOrName(member, config.playerRoleId, config.playerRoleName);
}

function userHasAdminRole(member) {
    return hasRoleByIdOrName(member, config.adminRoleId, config.adminRoleName);
}

module.exports = {
    userHasPlayerRole,
    userHasAdminRole
};
