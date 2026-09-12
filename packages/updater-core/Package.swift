// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "OtaKitUpdaterCore",
  platforms: [.iOS(.v15), .macOS(.v12)],
  products: [.library(name: "OtaKitUpdaterCore", targets: ["OtaKitUpdaterCore"])],
  dependencies: [.package(url: "https://github.com/weichsel/ZIPFoundation.git", exact: "0.9.20")],
  targets: [
    .target(name: "OtaKitUpdaterCore", dependencies: ["ZIPFoundation"], path: "ios/Sources"),
    .testTarget(
      name: "OtaKitUpdaterCoreTests", dependencies: ["OtaKitUpdaterCore"], path: "ios/Tests"),
  ]
)
