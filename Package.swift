// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AppactorCapacitor",
    platforms: [.iOS(.v16)],
    products: [
        .library(
            name: "AppactorCapacitor",
            targets: ["AppactorCapacitor"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/appactor/appactor-ios.git", exact: "0.2.1")
    ],
    targets: [
        .target(
            name: "AppactorCapacitor",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "AppActorPlugin", package: "appactor-ios")
            ],
            path: "ios/Sources/AppactorCapacitor"),
        .testTarget(
            name: "AppactorCapacitorTests",
            dependencies: ["AppactorCapacitor"],
            path: "ios/Tests/AppactorCapacitorTests")
    ]
)
