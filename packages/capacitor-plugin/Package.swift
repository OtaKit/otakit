// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OtakitCapacitorUpdater",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "OtakitCapacitorUpdater",
            targets: ["UpdaterPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.0.2"),
        .package(url: "https://github.com/weichsel/ZIPFoundation.git", .upToNextMajor(from: "0.9.0"))
    ],
    targets: [
        .target(
            name: "UpdaterPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "ZIPFoundation", package: "ZIPFoundation")
            ],
            path: "ios/Sources/UpdaterPlugin",
            exclude: ["UpdaterPlugin.m"])
    ]
)
