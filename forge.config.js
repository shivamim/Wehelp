const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
    packagerConfig: {
        asar: true,
        extraResource: ['./LICENSE', './src/assets/SystemAudioDump'],
        name: 'WeHelp',
        icon: 'src/assets/logo',
        ignore: [/^\/(?:tests|benchmarks|docs|scripts|work|out|\.git|\.github)(?:\/|$)/, /\.env(?:\.|$)/, /\.log$/],
    },
    rebuildConfig: {},
    makers: [
        {
            name: '@electron-forge/maker-squirrel',
            config: {
                name: 'WeHelp',
                ...(process.env.WEHELP_SIGN_CERT
                    ? { certificateFile: process.env.WEHELP_SIGN_CERT, certificatePassword: process.env.WEHELP_SIGN_PASSWORD }
                    : {}),
                productName: 'WeHelp',
                shortcutName: 'WeHelp',
                createDesktopShortcut: true,
                createStartMenuShortcut: true,
            },
        },
        {
            name: '@electron-forge/maker-dmg',
            platforms: ['darwin'],
        },
        {
            name: '@reforged/maker-appimage',
            platforms: ['linux'],
            config: {
                options: {
                    name: 'WeHelp',
                    productName: 'WeHelp',
                    genericName: 'AI Assistant',
                    description: 'Real-time multimodal AI desktop assistant',
                    categories: ['Development', 'Education'],
                    icon: 'src/assets/logo.png',
                },
            },
        },
    ],
    plugins: [
        {
            name: '@electron-forge/plugin-auto-unpack-natives',
            config: {},
        },
        // Fuses are used to enable/disable various Electron functionality
        // at package time, before code signing the application
        new FusesPlugin({
            version: FuseVersion.V1,
            [FuseV1Options.RunAsNode]: false,
            [FuseV1Options.EnableCookieEncryption]: true,
            [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
            [FuseV1Options.EnableNodeCliInspectArguments]: false,
            [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
            [FuseV1Options.OnlyLoadAppFromAsar]: true,
        }),
    ],
};
